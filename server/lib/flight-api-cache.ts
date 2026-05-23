import { and, eq } from "drizzle-orm"
import { db as defaultDb } from "../db"
import { flightApiCache } from "../db/schema"

/**
 * Cross-user, cross-instance cache for AeroDataBox lookups. Sits in front of
 * lookupFlight() so the API is hit at most once per (flightNumber, flightDate)
 * within the TTL — regardless of how many users own a matching flights row or
 * how many concurrent requests arrive.
 *
 * Layers (cheapest first):
 *   1. In-flight dedup (Map<key, Promise>) — coalesces concurrent calls in
 *      the same process. Frees the slot once the promise settles.
 *   2. DB cache table (flight_api_cache) — survives serverless cold starts
 *      and is shared across instances and users.
 *   3. Negative cache — 404s are stored with notFound=true so we don't keep
 *      asking AeroDataBox for flights it doesn't know about.
 *   4. Rate-limit cooldown — after a 429, suppress outbound calls for
 *      RATE_LIMIT_COOLDOWN_MS and serve stale cache instead.
 *
 * TTL is tiered by how close `now` is to the flight date:
 *   - past  (>24h after): cached effectively forever (data is final)
 *   - active (within ±24h): 5 min — gate/terminal/status churn fast
 *   - future (>24h before): 2h — matches the per-row shouldRefresh() baseline
 *   - negative (notFound): 24h
 *
 * Schema-version invalidation: entries with a lower lookupSchemaVersion than
 * the caller passes are treated as stale, so a bump on FLIGHT_LOOKUP_SCHEMA_VERSION
 * naturally refetches everything.
 */

type DbHandle = typeof defaultDb

export interface CacheEntry {
  response: Record<string, unknown> | null
  notFound: boolean
  fetchedAt: Date
  lookupSchemaVersion: number
}

export type FlightWindow = "past" | "active" | "future"

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ACTIVE_TTL_MS = 5 * 60 * 1000
const FUTURE_TTL_MS = 2 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000

/**
 * Bucket a flight by how close `now` is to its scheduled date. Active is the
 * window where gate/terminal/status changes propagate most often.
 */
export function classifyFlight(flightDate: string, now: Date): FlightWindow {
  // flightDate is an ISO date (YYYY-MM-DD) in the departure airport's local
  // calendar. We treat it as UTC midnight for the classification math; the ±24h
  // window is wide enough that timezone slop doesn't matter.
  const flightStart = new Date(flightDate + "T00:00:00Z").getTime()
  const flightEnd = flightStart + ONE_DAY_MS
  const t = now.getTime()
  if (t > flightEnd + ONE_DAY_MS) return "past"
  if (t < flightStart - ONE_DAY_MS) return "future"
  return "active"
}

export function isCacheFresh(
  entry: CacheEntry,
  flightDate: string,
  currentSchemaVersion: number,
  now: Date,
): boolean {
  if (entry.lookupSchemaVersion < currentSchemaVersion) return false
  if (entry.notFound) {
    return now.getTime() - entry.fetchedAt.getTime() < NEGATIVE_TTL_MS
  }
  const window = classifyFlight(flightDate, now)
  if (window === "past") return true
  const ttl = window === "active" ? ACTIVE_TTL_MS : FUTURE_TTL_MS
  return now.getTime() - entry.fetchedAt.getTime() < ttl
}

// --- Store abstraction --------------------------------------------------------

export interface CacheStore {
  get(flightNumber: string, flightDate: string): Promise<CacheEntry | null>
  set(flightNumber: string, flightDate: string, entry: CacheEntry): Promise<void>
}

export function makeMemoryStore(): CacheStore {
  const map = new Map<string, CacheEntry>()
  const k = (fn: string, fd: string) => `${fn}|${fd}`
  return {
    async get(fn, fd) {
      return map.get(k(fn, fd)) ?? null
    },
    async set(fn, fd, entry) {
      map.set(k(fn, fd), entry)
    },
  }
}

export function makeDrizzleStore(db: DbHandle = defaultDb): CacheStore {
  return {
    async get(flightNumber, flightDate) {
      const row = await db.query.flightApiCache.findFirst({
        where: and(
          eq(flightApiCache.flightNumber, flightNumber),
          eq(flightApiCache.flightDate, flightDate),
        ),
      })
      if (!row) return null
      return {
        response: row.response,
        notFound: row.notFound,
        fetchedAt: row.fetchedAt,
        lookupSchemaVersion: row.lookupSchemaVersion,
      }
    },
    async set(flightNumber, flightDate, entry) {
      await db
        .insert(flightApiCache)
        .values({
          flightNumber,
          flightDate,
          response: entry.response,
          notFound: entry.notFound,
          fetchedAt: entry.fetchedAt,
          lookupSchemaVersion: entry.lookupSchemaVersion,
        })
        .onConflictDoUpdate({
          target: [flightApiCache.flightNumber, flightApiCache.flightDate],
          set: {
            response: entry.response,
            notFound: entry.notFound,
            fetchedAt: entry.fetchedAt,
            lookupSchemaVersion: entry.lookupSchemaVersion,
          },
        })
    },
  }
}

let defaultStore: CacheStore | null = null
function getDefaultStore(): CacheStore {
  if (!defaultStore) defaultStore = makeDrizzleStore()
  return defaultStore
}

export interface StoreOptions {
  store?: CacheStore
}

export async function getCachedFlight(
  flightNumber: string,
  flightDate: string,
  opts: StoreOptions = {},
): Promise<CacheEntry | null> {
  const store = opts.store ?? getDefaultStore()
  return store.get(flightNumber, flightDate)
}

export async function setCachedFlight(
  flightNumber: string,
  flightDate: string,
  entry: CacheEntry,
  opts: StoreOptions = {},
): Promise<void> {
  const store = opts.store ?? getDefaultStore()
  return store.set(flightNumber, flightDate, entry)
}

// --- In-flight request dedup --------------------------------------------------

const inFlight = new Map<string, Promise<unknown>>()

export function dedupInFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const promise = factory().finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}

// --- Process-level 429 cooldown -----------------------------------------------

let rateLimitedUntil: number | null = null

export function markRateLimited(now: Date = new Date()): void {
  rateLimitedUntil = now.getTime() + RATE_LIMIT_COOLDOWN_MS
}

export function isRateLimited(now: Date = new Date()): boolean {
  if (rateLimitedUntil === null) return false
  if (now.getTime() >= rateLimitedUntil) {
    rateLimitedUntil = null
    return false
  }
  return true
}

/** Test helper — resets the process-wide cooldown. */
export function clearRateLimitState(): void {
  rateLimitedUntil = null
}
