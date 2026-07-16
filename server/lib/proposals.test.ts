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

const { proposalSchema, resultToProposals, applyProposal } = await import("./proposals")

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
