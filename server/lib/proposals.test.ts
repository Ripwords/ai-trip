// proposals.ts transitively imports google-maps.ts (via enrich) and db/index.ts,
// which register a Nitro auto-import and read DATABASE_URL at module-eval time.
// Static imports are hoisted and evaluated before any of this file's own
// top-level statements, so the shim/env-var must be set *and* proposals.ts
// imported dynamically afterward — see enrich.test.ts for the same pattern.
;(globalThis as { defineCachedFunction?: unknown }).defineCachedFunction = (fn: unknown) => fn
// applyProposal throws via the Nitro/h3 auto-import `createError`, also absent
// in a raw node:test process — shim it the same way.
;(
  globalThis as { createError?: (input: { statusCode?: number; message?: string }) => Error }
).createError = (input) => Object.assign(new Error(input.message ?? ""), input)
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AIProcessResult } from "./ai"

const { proposalSchema, resultToProposals, applyProposal, resolveDayOrder } =
  await import("./proposals")

describe("proposalSchema", () => {
  it("accepts an add-activities proposal with a valid payload", () => {
    const result = proposalSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "add-activities",
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Add Afuri Ramen at 12:30",
      payload: {
        activities: [
          {
            name: "Afuri Ramen",
            type: "restaurant",
            description: "Yuzu shio ramen",
            suggestedTime: "12:30",
            estimatedDurationMinutes: 60,
            costEstimate: 15,
            tags: ["ramen", "lunch"],
          },
        ],
      },
    })
    assert.equal(result.success, true)
  })

  it("rejects an unknown kind", () => {
    const result = proposalSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "delete-day",
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Delete day",
      payload: {},
    })
    assert.equal(result.success, false)
  })

  it("accepts a reorder-activities proposal with a non-empty id list", () => {
    const result = proposalSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "reorder-activities",
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Move museum before castle",
      payload: {
        orderedActivityIds: [
          "33333333-3333-4333-8333-333333333333",
          "44444444-4444-4444-8444-444444444444",
        ],
      },
    })
    assert.equal(result.success, true)
  })

  it("rejects a reorder-activities proposal with an empty id list", () => {
    const result = proposalSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "reorder-activities",
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Reorder",
      payload: { orderedActivityIds: [] },
    })
    assert.equal(result.success, false)
  })

  it("accepts a reschedule proposal with multiple updates", () => {
    const result = proposalSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "reschedule",
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Move dinner later",
      payload: {
        updates: [
          {
            activityId: "33333333-3333-4333-8333-333333333333",
            suggestedTime: "19:00",
            estimatedDurationMinutes: 90,
          },
        ],
      },
    })
    assert.equal(result.success, true)
  })
})

describe("proposalSchema time validation", () => {
  const reschedule = (suggestedTime: string) =>
    proposalSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "reschedule",
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Move dinner",
      payload: {
        updates: [
          {
            activityId: "33333333-3333-4333-8333-333333333333",
            suggestedTime,
            estimatedDurationMinutes: 60,
          },
        ],
      },
    })

  // The old /^\d{2}:\d{2}$/ matched the shape but not the range, so these
  // reached the database as-is.
  it("rejects times that look like HH:MM but are not real clock times", () => {
    for (const t of ["99:99", "45:67", "24:00", "23:60"]) {
      assert.equal(reschedule(t).success, false, `expected ${t} to be rejected`)
    }
  })

  it("accepts real clock times at the boundaries", () => {
    for (const t of ["00:00", "09:05", "23:59"]) {
      assert.equal(reschedule(t).success, true, `expected ${t} to be accepted`)
    }
  })
})

const dayFixture = {
  id: "22222222-2222-4222-8222-222222222222",
  activities: [
    { id: "33333333-3333-4333-8333-333333333333", name: "Museum" },
    { id: "44444444-4444-4444-8444-444444444444", name: "Temple" },
  ],
}

function blankResult(overrides: Partial<AIProcessResult> = {}): AIProcessResult {
  return {
    intent: "general",
    message: "",
    newActivities: [],
    removals: [],
    updates: [],
    shouldOptimize: false,
    ...overrides,
  }
}

describe("resultToProposals", () => {
  it("returns an add-activities proposal when newActivities is non-empty", () => {
    const result = blankResult({
      intent: "add",
      newActivities: [
        {
          name: "Afuri Ramen",
          type: "restaurant",
          description: "yuzu shio",
          suggestedTime: "12:30",
          estimatedDurationMinutes: 60,
          costEstimate: 15,
          tags: ["lunch"],
        },
      ],
    })
    const proposals = resultToProposals(result, dayFixture)
    assert.equal(proposals.length, 1)
    assert.equal(proposals[0]?.kind, "add-activities")
    assert.equal(proposals[0]?.dayId, dayFixture.id)
  })

  it("returns a remove-activities proposal with resolved activity ids", () => {
    const result = blankResult({
      intent: "remove",
      removals: [{ name: "Museum", reason: "not interested" }],
    })
    const proposals = resultToProposals(result, dayFixture)
    assert.equal(proposals.length, 1)
    if (proposals[0]?.kind !== "remove-activities") throw new Error("wrong kind")
    assert.deepEqual(proposals[0].payload.activityIds, ["33333333-3333-4333-8333-333333333333"])
  })

  it("drops removals that don't match any activity name", () => {
    const result = blankResult({
      intent: "remove",
      removals: [{ name: "Nonexistent place", reason: "?" }],
    })
    const proposals = resultToProposals(result, dayFixture)
    assert.equal(proposals.length, 0)
  })

  it("returns a reschedule proposal when updates is non-empty", () => {
    const result = blankResult({
      intent: "reschedule",
      updates: [{ name: "Museum", suggestedTime: "10:00", estimatedDurationMinutes: 90 }],
    })
    const proposals = resultToProposals(result, dayFixture)
    assert.equal(proposals.length, 1)
    if (proposals[0]?.kind !== "reschedule") throw new Error("wrong kind")
    assert.equal(
      proposals[0].payload.updates[0]?.activityId,
      "33333333-3333-4333-8333-333333333333",
    )
  })

  it("returns an optimize-route proposal when shouldOptimize is true and no other changes", () => {
    const result = blankResult({ intent: "optimize", shouldOptimize: true })
    const proposals = resultToProposals(result, dayFixture)
    assert.equal(proposals.length, 1)
    assert.equal(proposals[0]?.kind, "optimize-route")
  })

  // The AI's optimize pass returns a time per activity alongside the order.
  // Carrying only the ids threw those times away, so applying the card
  // reshuffled rows and left the old (often overlapping) times in place.
  it("carries the AI's optimize times onto the optimize-route payload", () => {
    const result = blankResult({
      intent: "optimize",
      shouldOptimize: true,
      orderedActivities: [
        { id: "44444444-4444-4444-8444-444444444444", name: "Temple", suggestedTime: "09:00" },
        { id: "33333333-3333-4333-8333-333333333333", name: "Museum", suggestedTime: "13:30" },
      ],
    })
    const proposals = resultToProposals(result, dayFixture)
    if (proposals[0]?.kind !== "optimize-route") throw new Error("wrong kind")
    assert.deepEqual(proposals[0].payload.orderedActivityIds, [
      "44444444-4444-4444-8444-444444444444",
      "33333333-3333-4333-8333-333333333333",
    ])
    assert.deepEqual(proposals[0].payload.orderedActivities, [
      { id: "44444444-4444-4444-8444-444444444444", suggestedTime: "09:00" },
      { id: "33333333-3333-4333-8333-333333333333", suggestedTime: "13:30" },
    ])
  })

  it("drops optimize times that are unparseable rather than persisting them", () => {
    const result = blankResult({
      intent: "optimize",
      shouldOptimize: true,
      orderedActivities: [
        { id: "44444444-4444-4444-8444-444444444444", name: "Temple", suggestedTime: "99:99" },
        { id: "33333333-3333-4333-8333-333333333333", name: "Museum", suggestedTime: "9:05" },
      ],
    })
    const proposals = resultToProposals(result, dayFixture)
    if (proposals[0]?.kind !== "optimize-route") throw new Error("wrong kind")
    // Order is still carried for both; only the bad time is dropped, and the
    // loose "9:05" is normalized to zero-padded HH:MM.
    assert.deepEqual(proposals[0].payload.orderedActivityIds, [
      "44444444-4444-4444-8444-444444444444",
      "33333333-3333-4333-8333-333333333333",
    ])
    assert.deepEqual(proposals[0].payload.orderedActivities, [
      { id: "33333333-3333-4333-8333-333333333333", suggestedTime: "09:05" },
    ])
  })

  it("returns a set-accommodation proposal when accommodation is present", () => {
    const result = blankResult({
      intent: "accommodation",
      accommodation: { name: "Hotel X", address: "1-1", lat: 35.6, lng: 139.7, placeId: "p1" },
    })
    const proposals = resultToProposals(result, dayFixture)
    assert.equal(proposals.length, 1)
    assert.equal(proposals[0]?.kind, "set-accommodation")
  })

  it("returns multiple proposals for modify intent (remove + add)", () => {
    const result = blankResult({
      intent: "modify",
      removals: [{ name: "Museum", reason: "swap" }],
      newActivities: [
        {
          name: "Gallery",
          type: "museum",
          description: "",
          suggestedTime: "10:00",
          estimatedDurationMinutes: 90,
          costEstimate: 10,
          tags: [],
        },
      ],
    })
    const proposals = resultToProposals(result, dayFixture)
    assert.equal(proposals.length, 2)
    const kinds = proposals.map((p) => p.kind).toSorted()
    assert.deepEqual(kinds, ["add-activities", "remove-activities"])
  })
})

// optimize-route used to write `sortOrder: i` for ONLY the ids it was given,
// leaving every unlisted activity on its old sortOrder — a partial list then
// produced duplicate sortOrder values and a scrambled day. reorder-activities
// always did this correctly; both now share resolveDayOrder.
describe("resolveDayOrder", () => {
  const day = ["a", "b", "c", "d", "e"]

  it("returns every activity exactly once when given a partial order", () => {
    const order = resolveDayOrder(day, ["d", "b"])
    assert.deepEqual(order, ["d", "b", "a", "c", "e"])
    assert.equal(new Set(order).size, day.length)
  })

  it("keeps unlisted activities in their existing relative order", () => {
    assert.deepEqual(resolveDayOrder(day, ["e"]), ["e", "a", "b", "c", "d"])
  })

  it("ignores ids that are not on the day", () => {
    assert.deepEqual(resolveDayOrder(day, ["zzz", "c"]), ["c", "a", "b", "d", "e"])
  })

  it("ignores a repeated id rather than emitting it twice", () => {
    const order = resolveDayOrder(day, ["b", "b", "a"])
    assert.deepEqual(order, ["b", "a", "c", "d", "e"])
    assert.equal(new Set(order).size, day.length)
  })

  it("falls back to the existing order when given no ids", () => {
    assert.deepEqual(resolveDayOrder(day, []), day)
    assert.deepEqual(resolveDayOrder(day, undefined), day)
  })
})

describe("applyProposal", () => {
  it("rejects a proposal whose dayId does not match the ctx", async () => {
    await assert.rejects(
      () =>
        applyProposal(
          {
            id: "11111111-1111-4111-8111-111111111111",
            kind: "optimize-route",
            dayId: "99999999-9999-4999-8999-999999999999",
            summary: "Optimize",
            payload: {},
          },
          {
            tripId: "55555555-5555-4555-8555-555555555555",
            dayId: "22222222-2222-4222-8222-222222222222",
            userId: "u1",
            transportMode: "walking",
            currencyCode: "USD",
          },
        ),
      /dayId mismatch/i,
    )
  })
})

describe("proposalSchema group metadata", () => {
  it("accepts optional groupId and groupLabel", () => {
    const result = proposalSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "add-activities",
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Add a cafe",
      groupId: "33333333-3333-4333-8333-333333333333",
      groupLabel: "Coffee every morning",
      payload: {
        activities: [
          {
            name: "Cafe",
            type: "cafe",
            description: "coffee",
            suggestedTime: "09:00",
            estimatedDurationMinutes: 30,
            costEstimate: 5,
            tags: [],
          },
        ],
      },
    })
    assert.equal(result.success, true)
    assert.equal(result.success && result.data.groupId, "33333333-3333-4333-8333-333333333333")
  })
})

// The generation handlers used `e.includes(n) || n.includes(e)`, which dropped
// any suggestion whose name was a substring of an existing one (or vice versa).
describe("filterDuplicateActivities substring safety", () => {
  it("keeps a distinct venue whose name is a substring of an existing one", async () => {
    const { filterDuplicateActivities } = await import("./proposals")
    const { fresh, duplicates } = filterDuplicateActivities(
      [{ name: "Bar Trench" }, { name: "Ueno Park" }],
      [{ name: "Sushi Bar" }, { name: "Ueno Park Zoo" }],
    )
    assert.deepEqual(
      fresh.map((f) => f.name),
      ["Bar Trench", "Ueno Park"],
    )
    assert.equal(duplicates.length, 0)
  })

  it("still drops an exact duplicate regardless of case and padding", async () => {
    const { filterDuplicateActivities } = await import("./proposals")
    const { fresh, duplicates } = filterDuplicateActivities(
      [{ name: "  afuri ramen " }],
      [{ name: "Afuri Ramen" }],
    )
    assert.equal(fresh.length, 0)
    assert.equal(duplicates.length, 1)
  })
})

describe("filterDuplicateActivities", () => {
  it("splits incoming activities into fresh and same-day duplicates", async () => {
    const { filterDuplicateActivities } = await import("./proposals")
    const { fresh, duplicates } = filterDuplicateActivities(
      [
        { name: "Bếp Cuốn Đà Nẵng", placeId: null },
        { name: "New Cafe", placeId: "place-new" },
        { name: "Renamed Bridge", placeId: "place-bridge" },
      ],
      [
        { name: "bếp cuốn đà nẵng ", placeId: "place-bep" },
        { name: "Dragon Bridge", placeId: "place-bridge" },
      ],
    )
    assert.deepEqual(
      fresh.map((a) => a.name),
      ["New Cafe"],
    )
    assert.deepEqual(
      duplicates.map((a) => a.name),
      ["Bếp Cuốn Đà Nẵng", "Renamed Bridge"],
    )
  })

  it("returns everything fresh when the day is empty", async () => {
    const { filterDuplicateActivities } = await import("./proposals")
    const { fresh, duplicates } = filterDuplicateActivities([{ name: "A", placeId: null }], [])
    assert.equal(fresh.length, 1)
    assert.equal(duplicates.length, 0)
  })
})
