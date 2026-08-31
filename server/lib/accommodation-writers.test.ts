/**
 * The single-writer invariant, enforced against the source tree.
 *
 * `itinerary_days.accommodation_*` is a derived read-cache of `stays`, and
 * `reconcileTripStays` derives *from* those columns — so it treats whatever the
 * days say as truth and cannot detect that the cache is wrong. There is
 * deliberately no repair job: a repair would need a second source of truth to
 * repair against, and there is none. What makes that safe is that drift is
 * unreachable by construction — every path that can change a trip's
 * accommodation runs `reconcileTripStays` in the same transaction.
 *
 * That is a whole-codebase property, not a property of any one function, so it
 * is asserted the only way it can be: by enumerating every server file that
 * mutates `itinerary_days` at all and requiring each to be classified below.
 * Scanning for the column names themselves would miss two of them —
 * `accommodation.put.ts` and `range.put.ts` write a validated body object and
 * never name a column — which is exactly the kind of gap that let the AI and
 * undo write paths go unnoticed.
 *
 * Adding a new day writer is fine. Adding one that changes accommodation, or
 * removes days, without reconciling is the bug this catches.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const SERVER_ROOT = join(import.meta.dirname, "..")

/** Any mutation of the day table, however the values are supplied. */
const MUTATES_DAYS = /\.(update|insert|delete)\(itineraryDays\)/

/**
 * Files that change which hotel a trip's days imply, and so MUST reconcile in
 * the same transaction. Each one is a former or current source of drift.
 */
const MUST_RECONCILE = [
  // Sets the day's accommodation columns from a validated body.
  "api/trips/[id]/days/[dayId]/accommodation.put.ts",
  "api/trips/[id]/accommodation/range.put.ts",
  // Writes accommodation from an AI result.
  "api/trips/[id]/days/[dayId]/ai.post.ts",
  // Restores an accommodation snapshot — the undo for `set-accommodation`.
  "api/trips/[id]/days/[dayId]/restore.post.ts",
  // The `set-accommodation` proposal apply.
  "lib/proposals.ts",
  // Deletes days on a trip date change, which deletes nights out of a stay.
  "api/trips/[id].put.ts",
] as const

/**
 * Files that mutate days without ever changing accommodation, with why that is
 * safe. A new entry here is a claim that needs checking by eye.
 */
const CANNOT_DRIFT: Record<string, string> = {
  // The reconciler itself, and the single writer it calls.
  "lib/booking-sync.ts": "the reconciler",
  "lib/stays.ts": "syncDayAccommodation, the single writer",
  // Inserts blank days at trip creation — no accommodation to imply a run.
  "lib/trip-writes.ts": "inserts days with no accommodation",
  // Sets `stay_id` only, deliberately leaving `accommodation_*` untouched.
  "db/backfill-stays.ts": "links days to stays, never rewrites the cache",
  // Columns unrelated to accommodation.
  "api/trips/[id]/days/[dayId]/notes.put.ts": "writes notes only",
}

async function serverFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (entry.name === "migrations") continue // DDL only — it writes no values
      out.push(...(await serverFiles(join(dir, entry.name), rel)))
    } else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
      out.push(rel)
    }
  }
  return out
}

describe("every writer of itinerary_days is accounted for", async () => {
  const files = await serverFiles(SERVER_ROOT)
  const sources = new Map<string, string>()
  for (const file of files) sources.set(file, await readFile(join(SERVER_ROOT, file), "utf8"))

  const mutators = [...sources]
    .filter(([, source]) => MUTATES_DAYS.test(source))
    .map(([file]) => file)
    .toSorted()

  it("classifies every file that mutates the day table", () => {
    assert.deepEqual(
      mutators,
      [...MUST_RECONCILE, ...Object.keys(CANNOT_DRIFT)].toSorted(),
      "a new itinerary_days writer must either reconcile or be shown unable to change accommodation",
    )
  })

  // The blocker this file exists for: AI day generation and day undo both wrote
  // `accommodation_*` with no reconcile, so `stays` and the mirrored booking
  // kept the previous hotel while the itinerary showed the new one — and the
  // next accommodation edit then detached and deleted the stay holding the
  // user's confirmation number.
  for (const file of MUST_RECONCILE) {
    it(`${file} reconciles in the same transaction`, () => {
      const source = sources.get(file)
      assert.ok(source, `${file} is listed but does not exist`)
      assert.match(source, /db\.transaction\(/, `${file} must reconcile inside a transaction`)
      assert.match(
        source,
        /reconcileTripStays\(tx,/,
        `${file} changes what the days imply without reconciling`,
      )
      // Lock ordering: the trip row before any day row, or two concurrent
      // editors deadlock and Postgres aborts one of their saves.
      assert.match(
        source,
        /lockTripForStayWrite\(tx,/,
        `${file} must take the trip lock before writing days`,
      )
    })
  }

  it("only the reconciler calls the single writer", () => {
    const callers = [...sources]
      .filter(
        ([file, source]) => file !== "lib/stays.ts" && source.includes("syncDayAccommodation("),
      )
      .map(([file]) => file)
    assert.deepEqual(callers, ["lib/booking-sync.ts"])
  })

  it("only reconcileTripStays and the backfill write stays at all", () => {
    const writers = [...sources]
      .filter(([, source]) => /\.(update|insert|delete)\(stays\)/.test(source))
      .map(([file]) => file)
      .toSorted()
    assert.deepEqual(writers, ["db/backfill-stays.ts", "lib/booking-sync.ts"])
  })
})
