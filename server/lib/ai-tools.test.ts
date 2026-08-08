// ai-tools.ts transitively imports google-maps.ts (which registers the Nitro
// auto-import `defineCachedFunction` at module-eval time) and db/index.ts (which
// reads DATABASE_URL at eval and throws if it's missing). Static imports are
// hoisted and evaluated before this file's own top-level statements, so the
// shim + env-var must be set *and* ai-tools imported dynamically afterward —
// see enrich.test.ts (shim) and proposals.test.ts (dummy DATABASE_URL + dynamic
// import) for the same pattern.
;(globalThis as { defineCachedFunction?: unknown }).defineCachedFunction = (fn: unknown) => fn
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Proposal } from "./proposals"

const { createTripTools, createDiscussTools } = await import("./ai-tools")
const { db } = await import("../db")

// The propose*-remove/reschedule/reorder tools call validateActivityIds, which
// runs `db.query.activities.findMany`. Stub it so the id-check path is
// deterministic and never opens a real connection: an empty result means every
// id is treated as unknown (the "reject hallucinated ids" path). The real return
// is drizzle's internal PgRelationalQuery (not a Promise), which cannot be
// constructed here, so the stub is cast through `unknown`.
db.query.activities.findMany = (async () => []) as unknown as typeof db.query.activities.findMany

const TRIP_ID = "55555555-5555-4555-8555-555555555555"
const ACTIVE_DAY = "22222222-2222-4222-8222-222222222222"
const OTHER_DAY = "66666666-6666-4666-8666-666666666666"

// A ctx with the active day (plus a second valid day) as members.
function activeCtx() {
  return {
    tripId: TRIP_ID,
    activeDayId: ACTIVE_DAY,
    days: [
      { id: ACTIVE_DAY, dayNumber: 1 },
      { id: OTHER_DAY, dayNumber: 2 },
    ],
    transportMode: "walking" as const,
    currencyCode: "USD",
    usdRate: null,
  }
}

// A ctx with no day in scope (nothing open in the trip view).
function noDayCtx() {
  return {
    tripId: TRIP_ID,
    activeDayId: "",
    days: [],
    transportMode: "walking" as const,
    currencyCode: "USD",
    usdRate: null,
  }
}

// Mastra types a tool's `execute` as `(input, context) => Promise<unknown>` and
// marks it optional; this helper narrows both so a test can invoke it with just
// the input and read the `{ ok }` result.
/**
 * Invoke a tool's `execute` directly.
 *
 * Typed loosely on purpose: AI SDK `tool()` returns a large conditional type
 * whose `execute` signature varies with the inferred input schema, and pinning
 * it here would couple every call site to that inference. The tools under test
 * are exercised through their real schemas elsewhere; this helper only needs to
 * reach the function.
 */
async function runTool<TInput>(
  tool: { execute?: (...args: never[]) => unknown },
  input: TInput,
): Promise<{ ok: boolean; error?: string }> {
  assert.ok(tool.execute, "tool must expose an execute fn")
  const result = await (tool.execute as (i: TInput, c: unknown) => Promise<unknown>)(
    input,
    undefined,
  )
  return result as { ok: boolean; error?: string }
}

const sampleActivity = {
  name: "Afuri Ramen",
  type: "restaurant" as const,
  description: "yuzu shio",
  suggestedTime: "12:30",
  estimatedDurationMinutes: 60,
  costEstimate: 15,
  tags: ["lunch"],
}

describe("createTripTools", () => {
  it("returns the expected tool ids", () => {
    const tools = createTripTools(activeCtx())
    const ids = Object.keys(tools).toSorted()
    assert.deepEqual(ids, [
      "getDistance",
      "getPlaceDetails",
      "readDay",
      "readTripSummary",
      "runReview",
      "searchPlaces",
    ])
  })
})

describe("createDiscussTools", () => {
  it("returns the expected tool ids including web_search and propose_*", () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(activeCtx(), collector)
    const ids = Object.keys(tools).toSorted()
    assert.deepEqual(ids, [
      "getDistance",
      "getPlaceDetails",
      "proposeAddActivities",
      "proposeRemoveActivities",
      "proposeReorder",
      "proposeReschedule",
      "proposeSetAccommodation",
      "readDay",
      "readTripSummary",
      "runReview",
      "searchPlaces",
      "webSearch",
    ])
  })

  it("proposeAddActivities pushes a valid proposal using the active day id", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(activeCtx(), collector)
    const result = await runTool(tools.proposeAddActivities, {
      summary: "Add Afuri Ramen at 12:30",
      activities: [sampleActivity],
    })
    assert.equal(result.ok, true)
    assert.equal(collector.length, 1)
    assert.equal(collector[0]?.kind, "add-activities")
    assert.equal(collector[0]?.dayId, ACTIVE_DAY)
  })

  it("proposeAddActivities targets an explicit valid dayId", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(activeCtx(), collector)
    const result = await runTool(tools.proposeAddActivities, {
      summary: "Add Afuri Ramen to day 2",
      dayId: OTHER_DAY,
      activities: [sampleActivity],
    })
    assert.equal(result.ok, true)
    assert.equal(collector.length, 1)
    assert.equal(collector[0]?.dayId, OTHER_DAY)
  })

  it("proposeAddActivities fans out one proposal per dayId in dayIds", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(activeCtx(), collector)
    const result = await runTool(tools.proposeAddActivities, {
      summary: "Add a coffee stop to both days",
      dayIds: [ACTIVE_DAY, OTHER_DAY],
      activities: [sampleActivity],
    })
    assert.equal(result.ok, true)
    assert.equal(collector.length, 2)
    assert.deepEqual(
      collector.map((p) => p.dayId),
      [ACTIVE_DAY, OTHER_DAY],
    )
  })

  it("proposeAddActivities rejects an unknown dayId and pushes nothing", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(activeCtx(), collector)
    const result = await runTool(tools.proposeAddActivities, {
      summary: "Add to a day that isn't in the trip",
      dayId: "99999999-9999-4999-8999-999999999999",
      activities: [sampleActivity],
    })
    assert.equal(result.ok, false)
    assert.equal(collector.length, 0)
  })

  it("proposeAddActivities refuses when no active day is set in ctx", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(noDayCtx(), collector)
    const result = await runTool(tools.proposeAddActivities, {
      summary: "Add something",
      activities: [
        {
          name: "Cafe",
          type: "cafe" as const,
          description: "",
          suggestedTime: "10:00",
          estimatedDurationMinutes: 30,
          costEstimate: 5,
          tags: [],
        },
      ],
    })
    assert.equal(result.ok, false)
    assert.equal(collector.length, 0)
  })

  it("proposeReorder refuses when no active day is set in ctx", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(noDayCtx(), collector)
    const result = await runTool(tools.proposeReorder, {
      summary: "Reorder",
      orderedActivityIds: ["33333333-3333-4333-8333-333333333333"],
    })
    assert.equal(result.ok, false)
    assert.equal(collector.length, 0)
  })

  it("proposeReschedule rejects hallucinated activity ids", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(activeCtx(), collector)
    // Activity-id validation runs against the (stubbed, empty) day, so the
    // hallucinated id is unknown — this is the right behaviour: it must not
    // produce a no-op proposal.
    const result = await runTool(tools.proposeReschedule, {
      summary: "Reschedule",
      updates: [
        {
          activityId: "33333333-3333-4333-8333-333333333333",
          suggestedTime: "19:00",
          estimatedDurationMinutes: 60,
        },
      ],
    })
    assert.equal(result.ok, false)
    assert.equal(collector.length, 0)
  })
})

describe("summarizeTripForAgent", () => {
  it("keeps activity coordinates so route checks work on non-open days", async () => {
    const { summarizeTripForAgent } = await import("./ai-tools")
    const summary = summarizeTripForAgent({
      destination: "Da Nang",
      startDate: "2026-08-16",
      endDate: "2026-08-18",
      preferences: null,
      days: [
        {
          id: "d1",
          dayNumber: 1,
          date: "2026-08-16",
          accommodationName: "Four Seasons",
          activities: [
            {
              name: "Marble Mountains",
              type: "attraction",
              suggestedTime: "10:00",
              estimatedDurationMinutes: 120,
              lat: 16.0,
              lng: 108.26,
            },
          ],
        },
      ],
    })
    const activity = summary.days[0]?.activities[0]
    assert.equal(activity?.lat, 16.0)
    assert.equal(activity?.lng, 108.26)
    assert.equal(activity?.name, "Marble Mountains")
    assert.equal(summary.days[0]?.accommodation, "Four Seasons")
  })
})
