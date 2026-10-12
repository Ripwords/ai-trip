/**
 * Minimal Nitro stand-ins for route-level tests that import a handler directly.
 *
 * `defineEventHandler` is the identity, so a handler module's default export is
 * the raw `(event) => …` function. Validation helpers run the route's own zod
 * parser against `event.context` and turn a throw into a 400, as h3 does.
 *
 * Trip access is a configurable stub: these tests are about what a handler does
 * once it has (or has not) been granted access, and `requireTripAccess` itself
 * is covered by the reservations/expenses route tests against a fake database.
 *
 * Call `installNitroGlobals()` in a `beforeEach`: test files share one process,
 * and another file may have installed its own globals in between.
 */
import assert from "node:assert/strict"

export type TripRole = "owner" | "editor" | "viewer"

export interface FakeEvent {
  context: {
    params: Record<string, string>
    body: unknown
    query: Record<string, string>
    userId: string | null
  }
}

export interface LoggedAction {
  tripId: string
  userId: string
  action: string
  description: string
  metadata?: unknown
}

export interface Harness {
  /** `tripId → userId → role`. Anyone absent gets the same 404 the real check returns. */
  roles: Map<string, Map<string, TripRole>>
  /** Every `requireTripAccess` call, in order. */
  accessChecks: { tripId: string; userId: string }[]
  log: LoggedAction[]
}

export const harness: Harness = { roles: new Map(), accessChecks: [], log: [] }

export function resetHarness(roles: Record<string, Record<string, TripRole>> = {}): void {
  harness.roles = new Map(
    Object.entries(roles).map(([tripId, users]) => [tripId, new Map(Object.entries(users))]),
  )
  harness.accessChecks = []
  harness.log = []
}

type Validate<T> = (input: unknown) => T

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode })
}

function validated<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    throw httpError(400, error instanceof Error ? error.message : "Bad Request")
  }
}

async function requireTripAccessStub(
  tripId: string,
  userId: string,
  required?: TripRole | TripRole[],
) {
  harness.accessChecks.push({ tripId, userId })
  const role = harness.roles.get(tripId)?.get(userId)
  if (!role) throw httpError(404, "Trip not found")
  const allowed = required === undefined ? null : Array.isArray(required) ? required : [required]
  if (allowed && !allowed.includes(role)) throw httpError(403, "Insufficient permissions")
  return { tripId, userId, role, trip: { id: tripId, userId } }
}

export function installNitroGlobals(): void {
  const g = globalThis as Record<string, unknown>
  g.defineEventHandler = (handler: unknown) => handler
  g.getValidatedRouterParams = async <T>(event: FakeEvent, validate: Validate<T>) =>
    validated(() => validate(event.context.params))
  g.readValidatedBody = async <T>(event: FakeEvent, validate: Validate<T>) =>
    validated(() => validate(event.context.body))
  g.getValidatedQuery = async <T>(event: FakeEvent, validate: Validate<T>) =>
    validated(() => validate(event.context.query))
  g.readBody = async (event: FakeEvent) => event.context.body
  g.requireAuth = async (event: FakeEvent) => {
    const userId = event.context.userId
    if (!userId) throw httpError(401, "Unauthorized")
    return { user: { id: userId, name: "Test User", email: `${userId}@example.com` } }
  }
  g.requireTripAccess = requireTripAccessStub
  g.logTripAction = async (entry: LoggedAction) => {
    harness.log.push(entry)
  }
}

export function makeEvent(options: {
  userId?: string | null
  params?: Record<string, string>
  body?: unknown
  query?: Record<string, string>
}): FakeEvent {
  return {
    context: {
      params: options.params ?? {},
      body: options.body,
      query: options.query ?? {},
      userId: options.userId === undefined ? "user-owner" : options.userId,
    },
  }
}

/** Assert a handler rejected with a specific HTTP status. */
export async function assertStatus(promise: Promise<unknown>, statusCode: number): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal(
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : error,
      statusCode,
    )
    return true
  })
}

/** A handler's default export as the raw function `defineEventHandler` wraps. */
export type Handler<T> = (event: FakeEvent) => Promise<T>
