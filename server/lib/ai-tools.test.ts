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
import { modelMessageSchema } from "ai"
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
async function runToolRaw<TInput>(
  tool: { execute?: (...args: never[]) => unknown },
  input: TInput,
): Promise<unknown> {
  assert.ok(tool.execute, "tool must expose an execute fn")
  return (tool.execute as (i: TInput, c: unknown) => Promise<unknown>)(input, undefined)
}

async function runTool<TInput>(
  tool: { execute?: (...args: never[]) => unknown },
  input: TInput,
): Promise<{ ok: boolean; error?: string }> {
  return (await runToolRaw(tool, input)) as { ok: boolean; error?: string }
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

describe("readDay", () => {
  // `updatedAt` on itinerary_days and `lastEnrichAttempt` on activities are
  // drizzle `timestamp` columns, so a raw row carries JS `Date` objects.
  // readDay used to return that row verbatim. The AI SDK validates every
  // message against ModelMessage[] before each step, and a tool result's
  // `output.value` must satisfy jsonValueSchema, which admits only
  // null/string/number/boolean/object/array. A `Date` fails it, so the step
  // AFTER any readDay call died with AI_InvalidPromptError and took the whole
  // turn with it. Asserting against the SDK's own exported schema is the point:
  // it fails again the moment a non-JSON value creeps back into the projection.
  const dayRow = {
    id: ACTIVE_DAY,
    tripId: TRIP_ID,
    dayNumber: 1,
    date: "2026-04-01",
    notes: "temple day",
    stayId: null,
    accommodationName: "Park Hyatt",
    accommodationPlaceId: "place-1",
    accommodationAddress: "Nishi-Shinjuku, Tokyo",
    accommodationLat: 35.6855,
    accommodationLng: 139.6917,
    updatedAt: new Date("2026-08-05T10:00:00.000Z"),
    activities: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        itineraryDayId: ACTIVE_DAY,
        name: "Afuri Ramen",
        placeId: "place-2",
        type: "restaurant",
        description: "yuzu shio",
        lat: 35.6628,
        lng: 139.7315,
        address: "Roppongi, Tokyo",
        rating: "4.3",
        priceLevel: 2,
        openingHours: ["Mon 11:00-22:00"],
        photos: [],
        suggestedTime: "12:30",
        estimatedDurationMinutes: 60,
        costEstimate: "15.00",
        tags: ["lunch"],
        sortOrder: 0,
        notes: null,
        actualCost: null,
        lastEnrichAttempt: new Date("2026-08-04T09:00:00.000Z"),
      },
    ],
    travelSegments: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        itineraryDayId: ACTIVE_DAY,
        fromActivityId: "11111111-1111-4111-8111-111111111111",
        toActivityId: "44444444-4444-4444-8444-444444444444",
        durationSeconds: 900,
        distanceMeters: 1200,
        durationText: "15 mins",
        distanceText: "1.2 km",
        mode: "walking",
      },
    ],
  }

  function stubDay(row: unknown) {
    db.query.itineraryDays.findFirst = (async () =>
      row) as unknown as typeof db.query.itineraryDays.findFirst
  }

  it("returns a payload the AI SDK accepts as a tool result", async () => {
    stubDay(dayRow)
    const result = await runToolRaw(createTripTools(activeCtx()).readDay, {})

    const parsed = modelMessageSchema.safeParse({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "readDay",
          output: { type: "json", value: result },
        },
      ],
    })
    assert.ok(
      parsed.success,
      `readDay output is not a valid ModelMessage tool result: ${JSON.stringify(parsed.error?.issues)}`,
    )
  })

  it("keeps the day, activity, and travel-segment fields the agent plans with", async () => {
    stubDay(dayRow)
    const day = (await runToolRaw(createTripTools(activeCtx()).readDay, {})) as {
      id: string
      date: string
      accommodationName: string | null
      activities: { id: string; name: string; suggestedTime: string | null }[]
      travelSegments: { durationSeconds: number | null }[]
    }

    assert.equal(day.id, ACTIVE_DAY)
    assert.equal(day.date, "2026-04-01")
    assert.equal(day.accommodationName, "Park Hyatt")
    assert.equal(day.activities[0]?.id, "11111111-1111-4111-8111-111111111111")
    assert.equal(day.activities[0]?.suggestedTime, "12:30")
    assert.equal(day.travelSegments[0]?.durationSeconds, 900)
  })

  it("reports a missing day instead of throwing", async () => {
    stubDay(undefined)
    const result = await runToolRaw(createTripTools(activeCtx()).readDay, {})
    assert.deepEqual(result, { error: "day not found" })
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
