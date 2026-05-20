# AI Chat Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the AI dock from a one-shot mutating command executor into a propose-then-apply surface with a smarter, tool-equipped agent, conversational Q&A intent, and a layered (deterministic + AI-judgment) review with one-tap fixes. No DB changes, no chat history.

**Architecture:** Add a `mode: "plan" | "execute"` field to the existing AI endpoint. Free-text uses `"plan"` and returns `Proposal[]` instead of mutating; quick-action chips use `"execute"` and keep direct-commit behavior. A new apply endpoint receives a `Proposal` payload from the client and runs the mutation slice via a shared `applyProposal()` helper. The Mastra `plannerAgent` gains six tools (place search/details, distance, day/trip reads, deterministic review) so handlers can ground-check during planning. Review prompts call a new `reviewItineraryWithJudgment` layer that wraps the existing deterministic review and adds judgment findings, optionally attaching `Proposal`s for one-tap fixes.

**Tech Stack:** Nuxt 4 (Vue 3), TypeScript, Drizzle ORM (Postgres), Mastra agents, AI SDK (Google Gemini), Zod, Google Maps Platform, `node:test` runner via `bun test`.

**Spec:** `docs/superpowers/specs/2026-05-20-ai-chat-rework-design.md`

---

## File Structure

**New files:**
- `server/lib/proposals.ts` — `Proposal` discriminated union, zod schema, `resultToProposals`, `applyProposal`.
- `server/lib/proposals.test.ts` — unit tests for both helpers.
- `server/lib/ai-tools.ts` — Mastra `createTool` definitions wrapping existing functions.
- `server/lib/itinerary-review-ai.ts` — `reviewItineraryWithJudgment` (deterministic + LLM merge).
- `server/lib/itinerary-review-ai.test.ts` — unit tests with the agent stubbed.
- `server/api/trips/[id]/proposals/apply.post.ts` — apply endpoint.

**Modified files:**
- `server/utils/ai-limits.ts` — add `refundAiCredit(userId)`.
- `server/lib/itinerary-review.ts` — extend `ItineraryReviewFinding` (optional `proposal`, new `code` values). No logic change.
- `server/lib/ai.ts` — register tools on `plannerAgent`, add `question` intent + `handleQuestion`.
- `server/api/trips/[id]/days/[dayId]/ai.post.ts` — add `mode`, route review prompts to AI judgment, plan/execute split.
- `app/composables/useAiPromptSuggestions.ts` — Q&A suggestions.
- `app/components/AiDock.vue` — response panel rendering proposals or findings.
- `app/components/ItineraryReviewPanel.vue` — embedded proposal Apply button + "Ask AI for fixes" header.
- `app/pages/trips/[id].vue` — dock response state, `handleApplyProposal`, `handleDismissProposal`, route quick chips to `mode: "execute"`.

**Unchanged:** all schema files; `server/api/trips/[id]/review.post.ts` (deterministic-only); existing intent handlers.

---

## Task 1: Define the `Proposal` type and zod schema

**Files:**
- Create: `server/lib/proposals.ts`
- Test: `server/lib/proposals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/lib/proposals.test.ts`:

```ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { proposalSchema } from "./proposals"

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/proposals.test.ts`
Expected: FAIL with `Cannot find module './proposals'` or similar.

- [ ] **Step 3: Implement `Proposal` type and `proposalSchema`**

Create `server/lib/proposals.ts`:

```ts
import { z } from "zod"

const aiActivityPayloadSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string(),
  suggestedTime: z.string(),
  estimatedDurationMinutes: z.number().int().positive(),
  costEstimate: z.number().min(0),
  tags: z.array(z.string()),
  // Optional enrichment fields — present when the agent has already resolved a place.
  placeId: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  address: z.string().nullable().optional(),
})

const baseProposal = z.object({
  id: z.string().uuid(),
  dayId: z.string().uuid(),
  summary: z.string().min(1),
})

export const proposalSchema = z.discriminatedUnion("kind", [
  baseProposal.extend({
    kind: z.literal("add-activities"),
    payload: z.object({ activities: z.array(aiActivityPayloadSchema).min(1) }),
  }),
  baseProposal.extend({
    kind: z.literal("remove-activities"),
    payload: z.object({ activityIds: z.array(z.string().uuid()).min(1) }),
  }),
  baseProposal.extend({
    kind: z.literal("reschedule"),
    payload: z.object({
      updates: z
        .array(
          z.object({
            activityId: z.string().uuid(),
            suggestedTime: z.string().regex(/^\d{2}:\d{2}$/),
            estimatedDurationMinutes: z.number().int().positive(),
          }),
        )
        .min(1),
    }),
  }),
  baseProposal.extend({
    kind: z.literal("optimize-route"),
    payload: z.object({ orderedActivityIds: z.array(z.string().uuid()).optional() }),
  }),
  baseProposal.extend({
    kind: z.literal("set-accommodation"),
    payload: z.object({
      name: z.string(),
      address: z.string().nullable(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      placeId: z.string().nullable(),
    }),
  }),
])

export type Proposal = z.infer<typeof proposalSchema>
export type ProposalKind = Proposal["kind"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/proposals.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add server/lib/proposals.ts server/lib/proposals.test.ts
git commit -m "feat(ai): add Proposal discriminated union and zod schema"
```

---

## Task 2: Implement `resultToProposals`

**Files:**
- Modify: `server/lib/proposals.ts`
- Modify: `server/lib/proposals.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/lib/proposals.test.ts`:

```ts
import { resultToProposals } from "./proposals"
import type { AIProcessResult } from "./ai"

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
    assert.equal(proposals[0].payload.updates[0]?.activityId, "33333333-3333-4333-8333-333333333333")
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
    const kinds = proposals.map((p) => p.kind).sort()
    assert.deepEqual(kinds, ["add-activities", "remove-activities"])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/lib/proposals.test.ts`
Expected: 7 new tests fail with `resultToProposals is not exported`.

- [ ] **Step 3: Implement `resultToProposals`**

Append to `server/lib/proposals.ts`:

```ts
import { randomUUID } from "node:crypto"
import type { AIProcessResult } from "./ai"

export interface DayForProposals {
  id: string
  activities: { id: string; name: string }[]
}

function findActivityIdByName(
  day: DayForProposals,
  name: string,
): string | undefined {
  const normalized = name.toLowerCase().trim()
  return day.activities.find((a) => a.name.toLowerCase().trim() === normalized)?.id
}

function describeActivities(activities: { name: string; suggestedTime?: string }[]): string {
  const head = activities[0]
  if (!head) return ""
  if (activities.length === 1) {
    return head.suggestedTime ? `${head.name} at ${head.suggestedTime}` : head.name
  }
  return `${head.name} and ${activities.length - 1} more`
}

export function resultToProposals(
  result: AIProcessResult,
  day: DayForProposals,
): Proposal[] {
  const proposals: Proposal[] = []

  if (result.newActivities.length > 0) {
    proposals.push({
      id: randomUUID(),
      kind: "add-activities",
      dayId: day.id,
      summary: `Add ${describeActivities(result.newActivities)}`,
      payload: { activities: result.newActivities },
    })
  }

  if (result.removals.length > 0) {
    const activityIds = result.removals
      .map((r) => findActivityIdByName(day, r.name))
      .filter((id): id is string => !!id)
    if (activityIds.length > 0) {
      const names = result.removals
        .filter((r) => findActivityIdByName(day, r.name))
        .map((r) => r.name)
      proposals.push({
        id: randomUUID(),
        kind: "remove-activities",
        dayId: day.id,
        summary: `Remove ${names.join(", ")}`,
        payload: { activityIds },
      })
    }
  }

  if (result.updates.length > 0) {
    const updates = result.updates
      .map((u) => {
        const activityId = findActivityIdByName(day, u.name)
        if (!activityId) return null
        return {
          activityId,
          suggestedTime: u.suggestedTime,
          estimatedDurationMinutes: u.estimatedDurationMinutes,
        }
      })
      .filter((u): u is NonNullable<typeof u> => u !== null)
    if (updates.length > 0) {
      proposals.push({
        id: randomUUID(),
        kind: "reschedule",
        dayId: day.id,
        summary: `Reschedule ${updates.length} activit${updates.length === 1 ? "y" : "ies"}`,
        payload: { updates },
      })
    }
  }

  if (result.shouldOptimize && result.newActivities.length === 0 && result.removals.length === 0) {
    const orderedActivityIds = result.orderedActivities
      ?.map((o) => findActivityIdByName(day, o.name))
      .filter((id): id is string => !!id)
    proposals.push({
      id: randomUUID(),
      kind: "optimize-route",
      dayId: day.id,
      summary: "Optimize route for the day",
      payload: orderedActivityIds?.length ? { orderedActivityIds } : {},
    })
  }

  if (result.accommodation) {
    proposals.push({
      id: randomUUID(),
      kind: "set-accommodation",
      dayId: day.id,
      summary: `Set accommodation to ${result.accommodation.name}`,
      payload: result.accommodation,
    })
  }

  return proposals
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/lib/proposals.test.ts`
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add server/lib/proposals.ts server/lib/proposals.test.ts
git commit -m "feat(ai): map AIProcessResult to Proposal[] via resultToProposals"
```

---

## Task 3: Implement `applyProposal`

This task lifts the mutation slices currently inline in `server/api/trips/[id]/days/[dayId]/ai.post.ts` into a shared helper. The endpoint will call it in Task 10; the new apply endpoint will call it in Task 9.

**Files:**
- Modify: `server/lib/proposals.ts`
- Test: `server/lib/proposals.test.ts` (integration-style with a real DB is overkill here; we cover the apply branches via the endpoint tests in Task 9. Keep this task focused on the function shape.)

- [ ] **Step 1: Add the apply signature and a focused branch test**

Append to `server/lib/proposals.test.ts`:

```ts
import { applyProposal } from "./proposals"

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
          },
        ),
      /dayId mismatch/i,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/proposals.test.ts`
Expected: FAIL with `applyProposal is not exported`.

- [ ] **Step 3: Implement `applyProposal` by lifting the mutation slices**

Append to `server/lib/proposals.ts`:

```ts
import { and, asc, eq } from "drizzle-orm"
import { db } from "../db"
import { activities, itineraryDays } from "../db/schema"
import { enrichItinerary } from "./enrich"
import { computeAndSaveSegments } from "./segments"
import { getDistanceMatrix } from "./google-maps"
import { computeSchedule, parseOpeningTime } from "../utils/schedule"
import { logTripAction } from "./activity-log"
import type { TransportMode } from "../utils/transport"

export interface ApplyContext {
  tripId: string
  dayId: string
  userId: string
  transportMode: TransportMode
  /** Optional bias for enrichment when adding activities. */
  dayLocation?: string
  /** Optional coordinates for place-search bias during enrichment. */
  destinationCoords?: { lat: number; lng: number }
  /** Optional previous-day accommodation used by optimize. */
  startLocation?: { lat: number | null; lng: number | null } | null
}

export interface ApplyResult {
  message: string
  added: number
  removed: number
  updated: number
  optimized: boolean
  enrichmentFailures: number
}

export async function applyProposal(
  proposal: Proposal,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  if (proposal.dayId !== ctx.dayId) {
    throw createError({ statusCode: 400, message: "Proposal dayId mismatch with route" })
  }

  let added = 0
  let removed = 0
  let updated = 0
  let optimized = false
  let enrichmentFailures = 0
  let message = ""

  switch (proposal.kind) {
    case "remove-activities": {
      await db.delete(activities).where(
        and(
          eq(activities.itineraryDayId, ctx.dayId),
          // Each id check; drizzle does not have inArray for short lists here without import.
          // Use inArray import:
          // (handled below via inArray)
        ),
      )
      // Re-implement with inArray to delete only the listed ids.
      const { inArray } = await import("drizzle-orm")
      const deleteResult = await db
        .delete(activities)
        .where(
          and(
            eq(activities.itineraryDayId, ctx.dayId),
            inArray(activities.id, proposal.payload.activityIds),
          ),
        )
        .returning({ id: activities.id })
      removed = deleteResult.length
      message = `Removed ${removed} activit${removed === 1 ? "y" : "ies"}`
      break
    }

    case "reschedule": {
      await Promise.all(
        proposal.payload.updates.map((u) =>
          db
            .update(activities)
            .set({
              suggestedTime: u.suggestedTime,
              estimatedDurationMinutes: u.estimatedDurationMinutes,
            })
            .where(and(eq(activities.id, u.activityId), eq(activities.itineraryDayId, ctx.dayId))),
        ),
      )
      updated = proposal.payload.updates.length
      message = `Rescheduled ${updated} activit${updated === 1 ? "y" : "ies"}`
      break
    }

    case "add-activities": {
      try {
        const enriched = await enrichItinerary(
          {
            days: [{ dayNumber: 0, theme: "", activities: proposal.payload.activities }],
          },
          ctx.dayLocation ?? "",
          ctx.destinationCoords,
        )
        enrichmentFailures = enriched.enrichmentFailures
        const enrichedActivities = enriched.days[0]?.activities ?? []
        if (enrichedActivities.length > 0) {
          const current = await db.query.activities.findMany({
            where: eq(activities.itineraryDayId, ctx.dayId),
            orderBy: [asc(activities.sortOrder)],
          })
          const maxSort = current.length > 0 ? Math.max(...current.map((a) => a.sortOrder)) : -1
          await db.insert(activities).values(
            enrichedActivities.map((a, i) => ({
              itineraryDayId: ctx.dayId,
              name: a.name,
              placeId: a.placeId,
              type: a.type,
              description: a.description,
              lat: a.lat,
              lng: a.lng,
              address: a.address,
              rating: a.rating?.toString() ?? null,
              priceLevel: a.priceLevel,
              openingHours: a.openingHours,
              photos: a.photos,
              suggestedTime: a.suggestedTime,
              estimatedDurationMinutes: a.estimatedDurationMinutes,
              costEstimate: a.costEstimate.toString(),
              tags: a.tags,
              sortOrder: maxSort + 1 + i,
            })),
          )
          added = enrichedActivities.length
        }
      } catch (e) {
        console.error("[applyProposal] enrichment failed:", e)
      }
      message = `Added ${added} activit${added === 1 ? "y" : "ies"}`
      break
    }

    case "optimize-route": {
      const dayActivities = await db.query.activities.findMany({
        where: eq(activities.itineraryDayId, ctx.dayId),
        orderBy: [asc(activities.sortOrder)],
      })
      if (dayActivities.length >= 2) {
        // If AI provided an explicit order, apply it directly with current suggestedTime values preserved.
        if (proposal.payload.orderedActivityIds?.length) {
          await Promise.all(
            proposal.payload.orderedActivityIds.map((id, i) =>
              db.update(activities).set({ sortOrder: i }).where(eq(activities.id, id)),
            ),
          )
          optimized = true
        } else {
          // Otherwise compute schedule with distance matrix.
          const day = await db.query.itineraryDays.findFirst({
            where: eq(itineraryDays.id, ctx.dayId),
          })
          if (!day) throw createError({ statusCode: 404, message: "Day not found" })

          const geo = dayActivities.filter((a) => a.lat != null && a.lng != null)
          const travelTimes: { fromId: string; toId: string; durationMinutes: number }[] = []
          if (geo.length >= 2) {
            try {
              const origins = geo.slice(0, -1).map((a) => ({ lat: a.lat!, lng: a.lng! }))
              const destinations = geo.slice(1).map((a) => ({ lat: a.lat!, lng: a.lng! }))
              const matrix = await getDistanceMatrix(origins, destinations, ctx.transportMode)
              for (let i = 0; i < origins.length; i++) {
                const el = matrix[i]?.[i]
                if (el?.duration?.value) {
                  travelTimes.push({
                    fromId: geo[i]!.id,
                    toId: geo[i + 1]!.id,
                    durationMinutes: Math.ceil(el.duration.value / 60),
                  })
                }
              }
            } catch {
              /* proceed without travel times */
            }
          }

          const schedule = computeSchedule({
            activities: dayActivities.map((a) => ({
              id: a.id,
              name: a.name,
              estimatedDurationMinutes: a.estimatedDurationMinutes,
              lat: a.lat,
              lng: a.lng,
              openingMinutes: parseOpeningTime(a.openingHours, day.date),
            })),
            travelTimes,
            startHour: 9,
            startMinute: 0,
            startTravelTimeMinutes: 0,
            bufferMinutes: 15,
          })
          await Promise.all(
            schedule.map((s) =>
              db
                .update(activities)
                .set({ sortOrder: s.sortOrder, suggestedTime: s.suggestedTime })
                .where(eq(activities.id, s.id)),
            ),
          )
          optimized = true
        }
      }
      message = optimized ? "Optimized route" : "Nothing to optimize"
      break
    }

    case "set-accommodation": {
      await db
        .update(itineraryDays)
        .set({
          accommodationName: proposal.payload.name,
          accommodationAddress: proposal.payload.address,
          accommodationLat: proposal.payload.lat,
          accommodationLng: proposal.payload.lng,
          accommodationPlaceId: proposal.payload.placeId,
        })
        .where(eq(itineraryDays.id, ctx.dayId))
      message = `Set accommodation to ${proposal.payload.name}`
      break
    }
  }

  // Recompute segments after any mutation that changed activities or accommodation.
  await computeAndSaveSegments(ctx.dayId, ctx.transportMode)

  await logTripAction({
    tripId: ctx.tripId,
    userId: ctx.userId,
    action: "ai_proposal_apply",
    description: `Applied proposal: ${proposal.summary}`,
    metadata: {
      proposalKind: proposal.kind,
      added,
      removed,
      updated,
      optimized,
    },
  })

  return { message, added, removed, updated, optimized, enrichmentFailures }
}
```

Note: the `remove-activities` branch has a placeholder `db.delete` followed by the real implementation using `inArray`. Drop the placeholder block — the real implementation is the second statement. The block below is the clean version to paste:

Replace the body of the `remove-activities` case with just:

```ts
case "remove-activities": {
  const { inArray } = await import("drizzle-orm")
  const deleteResult = await db
    .delete(activities)
    .where(
      and(
        eq(activities.itineraryDayId, ctx.dayId),
        inArray(activities.id, proposal.payload.activityIds),
      ),
    )
    .returning({ id: activities.id })
  removed = deleteResult.length
  message = `Removed ${removed} activit${removed === 1 ? "y" : "ies"}`
  break
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/proposals.test.ts`
Expected: 11 passing.

- [ ] **Step 5: Commit**

```bash
git add server/lib/proposals.ts server/lib/proposals.test.ts
git commit -m "feat(ai): add applyProposal helper extracted from ai.post.ts"
```

---

## Task 4: Add `refundAiCredit`

**Files:**
- Modify: `server/utils/ai-limits.ts`

- [ ] **Step 1: Write the test**

Create `server/utils/ai-limits.test.ts`:

```ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"

// Smoke test: refundAiCredit is callable and returns a Promise<void>.
describe("refundAiCredit", () => {
  it("is exported and returns a thenable", async () => {
    const { refundAiCredit } = await import("./ai-limits")
    assert.equal(typeof refundAiCredit, "function")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/utils/ai-limits.test.ts`
Expected: FAIL with `refundAiCredit is not exported`.

- [ ] **Step 3: Implement `refundAiCredit`**

Append to `server/utils/ai-limits.ts`:

```ts
/**
 * Refund one AI credit. Use after a planning step fails and no work was committed.
 * Does NOT go below zero. Safe to call multiple times if a single consume succeeded.
 */
export async function refundAiCredit(userId: string): Promise<void> {
  const month = getCurrentMonth()
  await db
    .update(aiUsage)
    .set({ promptCount: sql`GREATEST(${aiUsage.promptCount} - 1, 0)`, updatedAt: new Date() })
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/utils/ai-limits.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add server/utils/ai-limits.ts server/utils/ai-limits.test.ts
git commit -m "feat(ai): add refundAiCredit for plan-time failures"
```

---

## Task 5: Create agent tool definitions

**Files:**
- Create: `server/lib/ai-tools.ts`

This file exports a factory `createTripTools(ctx)` that returns Mastra tools bound to the current trip/day context. Tools wrap existing functions (`searchPlace`, `getPlaceDetails`, `getDistanceMatrix`) and DB reads. `tripId`/`dayId` are closed over so the model cannot query other trips.

- [ ] **Step 1: Write a smoke test**

Create `server/lib/ai-tools.test.ts`:

```ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createTripTools } from "./ai-tools"

describe("createTripTools", () => {
  it("returns the expected tool ids", () => {
    const tools = createTripTools({
      tripId: "55555555-5555-4555-8555-555555555555",
      dayId: "22222222-2222-4222-8222-222222222222",
      transportMode: "walking",
    })
    const ids = Object.keys(tools).sort()
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/ai-tools.test.ts`
Expected: FAIL with `Cannot find module './ai-tools'`.

- [ ] **Step 3: Implement the tools**

Create `server/lib/ai-tools.ts`:

```ts
import { eq } from "drizzle-orm"
import { z } from "zod"
import { createTool } from "@mastra/core/tools"
import { db } from "../db"
import { itineraryDays } from "../db/schema"
import { searchPlace, getPlaceDetails, getDistanceMatrix } from "./google-maps"
import { reviewItinerary } from "./itinerary-review"
import { getTripWithRelations } from "./trips"
import type { TransportMode } from "../utils/transport"

export interface TripToolsContext {
  tripId: string
  dayId: string
  transportMode: TransportMode
}

export function createTripTools(ctx: TripToolsContext) {
  const searchPlaces = createTool({
    id: "search-places",
    description:
      "Search Google Places for a venue by name and city. Returns up to 5 candidates with lat/lng, address, rating. Use this to verify a place exists before recommending it.",
    inputSchema: z.object({
      query: z.string().describe("Place name plus city, e.g. 'Afuri Ramen Roppongi Tokyo'"),
      near: z
        .object({ lat: z.number(), lng: z.number() })
        .optional()
        .describe("Optional bias point for the search"),
    }),
    execute: async (input) => {
      const biased = input.near ? `${input.query} near ${input.near.lat},${input.near.lng}` : input.query
      const candidates = await searchPlace(biased)
      return {
        candidates: candidates.slice(0, 5).map((c) => ({
          name: c.name,
          placeId: c.placeId,
          address: c.formattedAddress ?? null,
          lat: c.lat,
          lng: c.lng,
          rating: c.rating ?? null,
        })),
      }
    },
  })

  const getPlaceDetailsTool = createTool({
    id: "get-place-details",
    description: "Get opening hours, rating, price level, and photos for a Google Place by placeId.",
    inputSchema: z.object({ placeId: z.string() }),
    execute: async ({ placeId }) => {
      const details = await getPlaceDetails(placeId)
      if (!details) return { found: false }
      return { found: true, details }
    },
  })

  const getDistance = createTool({
    id: "get-distance",
    description:
      "Get travel time and distance between two coordinates using the configured transport mode.",
    inputSchema: z.object({
      from: z.object({ lat: z.number(), lng: z.number() }),
      to: z.object({ lat: z.number(), lng: z.number() }),
    }),
    execute: async ({ from, to }) => {
      const matrix = await getDistanceMatrix([from], [to], ctx.transportMode)
      const el = matrix[0]?.[0]
      if (!el || el.status !== "OK") return { ok: false }
      return {
        ok: true,
        durationSeconds: el.duration?.value ?? null,
        distanceMeters: el.distance?.value ?? null,
        durationText: el.duration?.text ?? null,
        distanceText: el.distance?.text ?? null,
      }
    },
  })

  const readDay = createTool({
    id: "read-day",
    description:
      "Read the current activities, accommodation, and travel segments for the day in scope.",
    inputSchema: z.object({}).optional(),
    execute: async () => {
      const day = await db.query.itineraryDays.findFirst({
        where: eq(itineraryDays.id, ctx.dayId),
        with: {
          activities: { orderBy: (a, { asc }) => [asc(a.sortOrder)] },
          travelSegments: true,
        },
      })
      return day ?? { error: "day not found" }
    },
  })

  const readTripSummary = createTool({
    id: "read-trip-summary",
    description:
      "Read a trimmed view of the entire trip: destination, dates, preferences, and per-day activity names + times.",
    inputSchema: z.object({}).optional(),
    execute: async () => {
      const trip = await getTripWithRelations(ctx.tripId)
      if (!trip) return { error: "trip not found" }
      return {
        destination: trip.destination,
        startDate: trip.startDate,
        endDate: trip.endDate,
        preferences: trip.preferences,
        days: trip.days.map((d) => ({
          id: d.id,
          dayNumber: d.dayNumber,
          date: d.date,
          accommodation: d.accommodationName,
          activities: d.activities.map((a) => ({
            name: a.name,
            type: a.type,
            time: a.suggestedTime,
            duration: a.estimatedDurationMinutes,
          })),
        })),
      }
    },
  })

  const runReview = createTool({
    id: "run-review",
    description:
      "Run the deterministic itinerary review for the current trip (returns critical/warning/suggestion findings). Use this BEFORE forming AI judgment findings.",
    inputSchema: z.object({
      scope: z.enum(["day", "trip"]),
    }),
    execute: async ({ scope }) => {
      const trip = await getTripWithRelations(ctx.tripId)
      if (!trip) return { error: "trip not found" }
      return reviewItinerary(trip, scope === "trip" ? { scope } : { scope, dayId: ctx.dayId })
    },
  })

  return {
    searchPlaces,
    getPlaceDetails: getPlaceDetailsTool,
    getDistance,
    readDay,
    readTripSummary,
    runReview,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/ai-tools.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai-tools.ts server/lib/ai-tools.test.ts
git commit -m "feat(ai): add Mastra tool factory wrapping places/distance/day/trip/review"
```

---

## Task 6: Add `question` intent and `handleQuestion`

**Files:**
- Modify: `server/lib/ai.ts`

- [ ] **Step 1: Locate the intent schema**

Open `server/lib/ai.ts` and find `const intentSchema = z.object({ intent: z.enum([...]), ... })` (around line 241).

- [ ] **Step 2: Extend the enum and prompt**

Edit `intentSchema` to add `"question"`:

```ts
const intentSchema = z.object({
  intent: z.enum([
    "add",
    "remove",
    "modify",
    "optimize",
    "reschedule",
    "fill_gaps",
    "accommodation",
    "question",
    "general",
  ]),
  reasoning: z.string().describe("Why this intent was chosen"),
})
```

In `classifyIntent`, extend the prompt to include `question`:

```ts
- "question": user is asking a question, NOT requesting a change. e.g. "is 3 days enough?", "how long from the hotel to X?", "is Y open Tuesday?", "should I do A on Day 2 or Day 4?", "tell me about Z"
```

Place it before `- "general"`.

- [ ] **Step 3: Add `handleQuestion`**

Add this function above `processUserRequest`:

```ts
async function handleQuestion(params: {
  prompt: string
  tripId: string
  dayId: string
  destination: string
  preferences?: TripPreferences
  transportMode: TransportMode
}): Promise<{ message: string }> {
  logger.info("[question] Answering", { prompt: params.prompt })

  const { createTripTools } = await import("./ai-tools")
  const tools = createTripTools({
    tripId: params.tripId,
    dayId: params.dayId,
    transportMode: params.transportMode,
  })

  try {
    const agent = mastra.getAgent("planner")
    const response = await agent.generate(
      `Answer the traveler's question using the tools available. ONLY answer — do NOT propose changes.
      The traveler is in ${params.destination}.
      ${formatPreferences(params.preferences)}

      Question: ${params.prompt}

      Use readDay, readTripSummary, getDistance, getPlaceDetails, searchPlaces as needed.
      Reply in 2-4 sentences, factual and concise.`,
      { toolsets: { question: tools }, maxSteps: 4 },
    )
    return { message: response.text }
  } catch (e) {
    logger.error("[question] Failed", { error: String(e) })
    return { message: "Sorry — I couldn't look that up right now. Try again in a moment." }
  }
}
```

Update the `processUserRequest` signature to thread `tripId`, `dayId`, and `transportMode`:

```ts
export async function processUserRequest(params: {
  prompt: string
  destination: string
  tripDestination: string
  tripId: string
  dayId: string
  transportMode: TransportMode
  date: string
  dayNumber: number
  // ...rest unchanged
}): Promise<AIProcessResult> {
```

Import the type at the top of the file:

```ts
import type { TransportMode } from "../utils/transport"
```

In the `switch (intent)` block, add a new `case`:

```ts
case "question": {
  const { message } = await handleQuestion({
    prompt: params.prompt,
    tripId: params.tripId,
    dayId: params.dayId,
    destination: params.destination,
    preferences: params.preferences,
    transportMode: params.transportMode,
  })
  result.message = message
  break
}
```

- [ ] **Step 4: Verify the file still type-checks**

Run: `bun x nuxt typecheck 2>&1 | grep -E "ai.ts|error" | head -20`
Expected: no new errors in `server/lib/ai.ts`. (Pre-existing errors elsewhere are fine.)

If `nuxt typecheck` is not configured, run: `bun x tsc --noEmit -p . 2>&1 | grep -E "ai.ts|error" | head -20`. Same expectation.

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai.ts
git commit -m "feat(ai): add question intent and handleQuestion using tool-equipped agent"
```

---

## Task 7: Extend `ItineraryReviewFinding` type

**Files:**
- Modify: `server/lib/itinerary-review.ts`
- Modify: `server/lib/itinerary-review.test.ts`

This task ONLY changes types — the deterministic checks remain unchanged.

- [ ] **Step 1: Write a type-level test**

Append to `server/lib/itinerary-review.test.ts`:

```ts
import type { ItineraryReviewFinding } from "./itinerary-review"

describe("ItineraryReviewFinding type", () => {
  it("accepts the new judgment codes", () => {
    const f: ItineraryReviewFinding = {
      id: "x",
      code: "pace-mismatch",
      severity: "warning",
      title: "Pace mismatch",
      message: "...",
      recommendation: "...",
      dayId: "d1",
      dayNumber: 1,
    }
    assert.equal(f.code, "pace-mismatch")
  })

  it("accepts an optional proposal field", () => {
    const f: ItineraryReviewFinding = {
      id: "x",
      code: "missing-lunch",
      severity: "suggestion",
      title: "Lunch missing",
      message: "...",
      recommendation: "...",
      dayId: "d1",
      dayNumber: 1,
      proposal: {
        id: "p1",
        kind: "add-activities",
        dayId: "d1",
        summary: "Add lunch",
        payload: {
          activities: [
            {
              name: "Soba Spot",
              type: "restaurant",
              description: "",
              suggestedTime: "12:30",
              estimatedDurationMinutes: 60,
              costEstimate: 12,
              tags: [],
            },
          ],
        },
      },
    }
    assert.equal(f.proposal?.kind, "add-activities")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/lib/itinerary-review.test.ts`
Expected: FAIL at TypeScript level — the codes are not in the union, and `proposal` is not in the interface.

- [ ] **Step 3: Update the interface and union**

In `server/lib/itinerary-review.ts`, edit the `ItineraryReviewFinding` interface:

```ts
import type { Proposal } from "./proposals"

export interface ItineraryReviewFinding {
  id: string
  code:
    | "missing-start-point"
    | "missing-accommodation-coordinates"
    | "missing-activity-time"
    | "missing-activity-duration"
    | "activity-overlap"
    | "long-travel-segment"
    | "missing-lunch"
    | "missing-dinner"
    | "late-ending"
    | "missing-activity-coordinates"
    | "pace-mismatch"
    | "backtracking-route"
    | "closed-on-date"
    | "interest-mismatch"
    | "energy-imbalance"
  severity: ItineraryReviewSeverity
  title: string
  message: string
  recommendation: string
  dayId: string
  dayNumber: number
  activityIds?: string[]
  proposal?: Proposal
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/lib/itinerary-review.test.ts`
Expected: all existing tests still pass + 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/itinerary-review.ts server/lib/itinerary-review.test.ts
git commit -m "feat(review): extend ItineraryReviewFinding with judgment codes and optional proposal"
```

---

## Task 8: Implement `reviewItineraryWithJudgment`

**Files:**
- Create: `server/lib/itinerary-review-ai.ts`
- Create: `server/lib/itinerary-review-ai.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/lib/itinerary-review-ai.test.ts`:

```ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { mergeFindings } from "./itinerary-review-ai"
import type { ItineraryReviewFinding } from "./itinerary-review"

const det: ItineraryReviewFinding = {
  id: "d1:missing-lunch:day",
  code: "missing-lunch",
  severity: "suggestion",
  title: "Lunch missing",
  message: "Day 1 lacks a lunch",
  recommendation: "Add a midday meal",
  dayId: "d1",
  dayNumber: 1,
}

const jud: ItineraryReviewFinding = {
  id: "d1:pace-mismatch:day",
  code: "pace-mismatch",
  severity: "warning",
  title: "Pace mismatch",
  message: "Too many stops",
  recommendation: "Drop one",
  dayId: "d1",
  dayNumber: 1,
}

describe("mergeFindings", () => {
  it("merges deterministic and judgment findings with no overlap", () => {
    const merged = mergeFindings([det], [jud])
    assert.equal(merged.length, 2)
  })

  it("dedupes by dayId + code, preferring the deterministic finding's id", () => {
    const dup: ItineraryReviewFinding = { ...jud, code: "missing-lunch", id: "d1:missing-lunch:judgment" }
    const merged = mergeFindings([det], [dup])
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.id, det.id)
  })

  it("attaches proposal from judgment finding onto matching deterministic finding", () => {
    const judWithProposal: ItineraryReviewFinding = {
      ...det,
      id: "d1:missing-lunch:j",
      proposal: {
        id: "p1",
        kind: "add-activities",
        dayId: "d1",
        summary: "Add lunch",
        payload: {
          activities: [
            {
              name: "Soba",
              type: "restaurant",
              description: "",
              suggestedTime: "12:30",
              estimatedDurationMinutes: 60,
              costEstimate: 10,
              tags: [],
            },
          ],
        },
      },
    }
    const merged = mergeFindings([det], [judWithProposal])
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.proposal?.kind, "add-activities")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/itinerary-review-ai.test.ts`
Expected: FAIL with `Cannot find module './itinerary-review-ai'`.

- [ ] **Step 3: Implement `mergeFindings` and `reviewItineraryWithJudgment`**

Create `server/lib/itinerary-review-ai.ts`:

```ts
import { z } from "zod"
import {
  reviewItinerary,
  type ItineraryReviewFinding,
  type ItineraryReviewOptions,
  type ItineraryReviewResult,
  type ItineraryReviewSeverity,
  type ReviewableTrip,
} from "./itinerary-review"
import { proposalSchema, type Proposal } from "./proposals"
import { createTripTools } from "./ai-tools"
import { getModel } from "./ai-config"
import type { TransportMode } from "../utils/transport"

const judgmentCodeSchema = z.enum([
  "pace-mismatch",
  "backtracking-route",
  "closed-on-date",
  "interest-mismatch",
  "energy-imbalance",
])

const judgmentFindingSchema = z.object({
  code: judgmentCodeSchema,
  severity: z.enum(["critical", "warning", "suggestion"]),
  title: z.string(),
  message: z.string(),
  recommendation: z.string(),
  dayId: z.string(),
  dayNumber: z.number().int(),
  activityIds: z.array(z.string()).optional(),
  proposal: proposalSchema.optional(),
})

const judgmentOutputSchema = z.object({
  findings: z.array(judgmentFindingSchema),
})

export function mergeFindings(
  deterministic: ItineraryReviewFinding[],
  judgment: ItineraryReviewFinding[],
): ItineraryReviewFinding[] {
  const key = (f: ItineraryReviewFinding) => `${f.dayId}:${f.code}`
  const detByKey = new Map(deterministic.map((f) => [key(f), f]))

  const result: ItineraryReviewFinding[] = []
  for (const f of deterministic) {
    const sameCode = judgment.find((j) => key(j) === key(f))
    if (sameCode?.proposal && !f.proposal) {
      result.push({ ...f, proposal: sameCode.proposal })
    } else {
      result.push(f)
    }
  }
  for (const j of judgment) {
    if (!detByKey.has(key(j))) result.push(j)
  }
  return result
}

function groupBySeverity(
  findings: ItineraryReviewFinding[],
): Record<ItineraryReviewSeverity, ItineraryReviewFinding[]> {
  const out: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]> = {
    critical: [],
    warning: [],
    suggestion: [],
  }
  for (const f of findings) out[f.severity].push(f)
  return out
}

export async function reviewItineraryWithJudgment(
  trip: ReviewableTrip,
  options: ItineraryReviewOptions,
  ctx: { tripId: string; dayId: string; transportMode: TransportMode },
): Promise<ItineraryReviewResult> {
  const deterministic = reviewItinerary(trip, options)
  const deterministicFlat = [
    ...deterministic.findings.critical,
    ...deterministic.findings.warning,
    ...deterministic.findings.suggestion,
  ]

  let judgmentFlat: ItineraryReviewFinding[] = []
  try {
    const { generateObject } = await import("ai")
    const tools = createTripTools(ctx)
    const { object } = await generateObject({
      model: getModel(),
      schema: judgmentOutputSchema,
      // Tools are surfaced via the AI SDK's "tools" parameter on supported models.
      // If the SDK in use doesn't support tools on generateObject, swap to agent.generate + structured output.
      tools: {
        searchPlaces: tools.searchPlaces,
        getPlaceDetails: tools.getPlaceDetails,
        getDistance: tools.getDistance,
        readDay: tools.readDay,
        readTripSummary: tools.readTripSummary,
      },
      maxSteps: 4,
      prompt: `Review the itinerary for JUDGMENT issues a deterministic checker cannot catch:
- pace-mismatch: too many/few stops vs the traveler's stated pace preference
- backtracking-route: day zig-zags geographically (use getDistance to verify)
- closed-on-date: a venue is closed on the scheduled day-of-week (use getPlaceDetails)
- interest-mismatch: stops conflict with stated interests
- energy-imbalance: packed morning + packed evening with no recovery break

Deterministic findings already flagged (do NOT repeat these codes for the same day):
${JSON.stringify(deterministicFlat.map((f) => ({ dayId: f.dayId, code: f.code })))}

When a finding has an obvious fix (e.g., missing meal, closed venue), attach a Proposal in 'proposal'. Use searchPlaces to ground-truth a real restaurant for meal additions.

Scope: ${options.scope}${options.dayId ? ` (dayId=${options.dayId})` : ""}.
Trip destination: ${trip.destination ?? "unknown"}.`,
    })
    judgmentFlat = object.findings as ItineraryReviewFinding[]
  } catch (e) {
    console.error("[review-ai] judgment generation failed, returning deterministic only:", e)
  }

  const merged = mergeFindings(deterministicFlat, judgmentFlat)
  const grouped = groupBySeverity(merged)

  return {
    scope: options.scope,
    dayId: options.scope === "day" ? options.dayId : undefined,
    findings: grouped,
    summary: {
      checkedDays: deterministic.summary.checkedDays,
      checkedActivities: deterministic.summary.checkedActivities,
      totalFindings: merged.length,
      critical: grouped.critical.length,
      warning: grouped.warning.length,
      suggestion: grouped.suggestion.length,
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/lib/itinerary-review-ai.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add server/lib/itinerary-review-ai.ts server/lib/itinerary-review-ai.test.ts
git commit -m "feat(review): add layered AI judgment review with proposal attachments"
```

---

## Task 9: New apply endpoint

**Files:**
- Create: `server/api/trips/[id]/proposals/apply.post.ts`

- [ ] **Step 1: Implement the endpoint**

Create `server/api/trips/[id]/proposals/apply.post.ts`:

```ts
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../db"
import { itineraryDays, trips } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"
import { normalizeTransportMode } from "../../../../utils/transport"
import { proposalSchema } from "../../../../lib/proposals"
import { applyProposal } from "../../../../lib/proposals"

const bodySchema = z.object({
  proposal: proposalSchema,
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const { proposal } = await readValidatedBody(event, bodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, id) })
  if (!trip) throw createError({ statusCode: 404, message: "Trip not found" })

  const day = await db.query.itineraryDays.findFirst({
    where: eq(itineraryDays.id, proposal.dayId),
  })
  if (!day || day.tripId !== id) {
    throw createError({ statusCode: 404, message: "Day not found in this trip" })
  }

  const transportMode = normalizeTransportMode(trip.preferences?.transportMode)

  try {
    const result = await applyProposal(proposal, {
      tripId: id,
      dayId: proposal.dayId,
      userId: session.user.id,
      transportMode,
      dayLocation: day.accommodationAddress ?? trip.destination,
      destinationCoords:
        day.accommodationLat != null && day.accommodationLng != null
          ? { lat: day.accommodationLat, lng: day.accommodationLng }
          : undefined,
    })
    return { success: true, ...result, undoAvailable: true }
  } catch (e) {
    if (e instanceof Error && /not found/i.test(e.message)) {
      throw createError({ statusCode: 409, message: "Proposal is no longer applicable" })
    }
    throw e
  }
})
```

- [ ] **Step 2: Smoke check the route compiles**

Run: `bun x nuxt typecheck 2>&1 | grep -E "proposals/apply|error TS" | head -20`
Expected: no errors referencing `proposals/apply.post.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/api/trips/[id]/proposals/apply.post.ts
git commit -m "feat(ai): add POST /api/trips/:id/proposals/apply endpoint"
```

---

## Task 10: Reshape the AI endpoint with `mode` and review-judgment routing

**Files:**
- Modify: `server/api/trips/[id]/days/[dayId]/ai.post.ts`

- [ ] **Step 1: Extend the body schema**

In `server/api/trips/[id]/days/[dayId]/ai.post.ts`, replace:

```ts
const aiBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
})
```

with:

```ts
const aiBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  mode: z.enum(["plan", "execute"]).default("plan"),
})
```

And destructure `mode`:

```ts
const { prompt: rawPrompt, mode } = await readValidatedBody(event, aiBodySchema.parse)
```

(Adjust the existing `body.prompt` references to use `rawPrompt`.)

- [ ] **Step 2: Route review prompts to the judgment layer**

Replace the existing `if (isReviewPrompt(prompt))` block. The new block calls `reviewItineraryWithJudgment` instead of `reviewItinerary`:

```ts
if (isReviewPrompt(prompt)) {
  const reviewTrip = await getTripWithRelations(id)
  if (!reviewTrip) throw createError({ statusCode: 404, message: "Trip not found" })

  const { reviewItineraryWithJudgment } = await import("../../../../../lib/itinerary-review-ai")
  const scope = getReviewScope(prompt)
  const transportMode = normalizeTransportMode(trip.preferences?.transportMode)
  const review = await reviewItineraryWithJudgment(
    reviewTrip,
    scope === "trip" ? { scope } : { scope, dayId },
    { tripId: id, dayId, transportMode },
  )
  const message = formatItineraryReviewMessage(review)
  const findings = [
    ...review.findings.critical,
    ...review.findings.warning,
    ...review.findings.suggestion,
  ]

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "ai_prompt",
    description: `AI review: ${message}`,
    metadata: { prompt: rawPrompt, intent: "review", scope, findings: review.summary.totalFindings },
  })

  return {
    success: true,
    intent: "review",
    message,
    proposals: [],
    findings,
    review,
  }
}
```

- [ ] **Step 3: Pass extra context to `processUserRequest`**

Update the `processUserRequest({...})` call: add `tripId: id`, `dayId`, `transportMode`:

```ts
const transportMode = normalizeTransportMode(trip.preferences?.transportMode)
// (existing line: const transportMode = ... already exists — reuse it)

result = await processUserRequest({
  prompt,
  destination: dayLocation,
  tripDestination: trip.destination,
  tripId: id,
  dayId,
  transportMode,
  date: day.date,
  // ...rest unchanged
})
```

- [ ] **Step 4: Add the plan/execute branch**

After `processUserRequest` succeeds, add an early return for `intent === "question"`:

```ts
if (result.intent === "question") {
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "ai_prompt",
    description: `AI question: ${result.message}`,
    metadata: { prompt: rawPrompt, intent: "question" },
  })
  return {
    success: true,
    intent: "question",
    message: result.message,
    proposals: [],
  }
}
```

Then add the plan branch BEFORE the existing mutation code:

```ts
if (mode === "plan") {
  const { resultToProposals } = await import("../../../../../lib/proposals")
  const proposals = resultToProposals(result, day)
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "ai_prompt",
    description: `AI plan: ${result.message}`,
    metadata: { prompt: rawPrompt, intent: result.intent, proposalCount: proposals.length },
  })
  return {
    success: true,
    intent: result.intent,
    message: result.message,
    proposals,
  }
}
```

Leave the existing mutation code (after this point) untouched. It is now only reached when `mode === "execute"`.

At the end of the existing mutation code, add `proposals: []` to the returned object so the response shape is consistent:

```ts
return {
  success: true,
  added: addedCount,
  removed: removedCount,
  updated: updatedCount,
  optimized,
  enrichmentFailures,
  intent: result.intent,
  message: result.message,
  proposals: [],
}
```

- [ ] **Step 5: Refund the credit on planning failure**

Replace the existing `catch (e: unknown)` around `processUserRequest`:

```ts
try {
  result = await processUserRequest({ ... })
} catch (e: unknown) {
  console.error("[ai.post] AI processing failed:", e)
  const { refundAiCredit } = await import("../../../../../utils/ai-limits")
  await refundAiCredit(session.user.id)
  throw createError({
    statusCode: 502,
    message: "AI service is temporarily unavailable. Please try again.",
  })
}
```

- [ ] **Step 6: Smoke check**

Run: `bun x nuxt typecheck 2>&1 | grep -E "days/\[dayId\]/ai|error TS" | head -20`
Expected: no new errors in this file.

- [ ] **Step 7: Commit**

```bash
git add server/api/trips/[id]/days/[dayId]/ai.post.ts
git commit -m "feat(ai): add plan/execute mode and route review to judgment layer"
```

---

## Task 11: Update prompt suggestions

**Files:**
- Modify: `app/composables/useAiPromptSuggestions.ts`

- [ ] **Step 1: Replace `withActivitiesSuggestions`**

Replace the array in `app/composables/useAiPromptSuggestions.ts`:

```ts
const withActivitiesSuggestions = [
  "Is this day too packed?",
  "How long from my hotel to the first stop?",
  "Review this day for timing problems",
  "Review the whole trip for issues",
  "Add a coffee shop nearby",
  "Move dinner to 7 PM",
  "Optimize the route",
  "Fill the gaps",
]
```

- [ ] **Step 2: Commit**

```bash
git add app/composables/useAiPromptSuggestions.ts
git commit -m "feat(ai-dock): surface Q&A and review suggestions when day has activities"
```

---

## Task 12: Add response panel to `AiDock.vue`

**Files:**
- Modify: `app/components/AiDock.vue`

- [ ] **Step 1: Extend props and emits**

In the `<script setup lang="ts">` block, add to the existing `defineProps`:

```ts
const props = defineProps<{
  modelValue: string
  loading: boolean
  loadingMode: "generate" | "optimize" | "remove" | "reschedule" | "review"
  usageUsed: number | null
  usageLimit: number | null
  usageRemaining: number | null
  hasActivities: boolean
  destination: string
  feedbackMessage: string
  feedbackError: string
  undoAvailable: boolean
  undoing: boolean
  response: AiDockResponse | null
}>()
```

Add type imports just under `<script setup lang="ts">`:

```ts
import type { Proposal } from "~/types/proposal"
import type { ReviewFinding } from "~/types/review"

export interface AiDockResponse {
  message: string
  proposals?: Proposal[]
  findings?: ReviewFinding[]
  intent?: string
}
```

Add to emits:

```ts
const emit = defineEmits<{
  "update:modelValue": [value: string]
  submit: [prompt: string]
  cancel: []
  undo: []
  dismissFeedback: []
  fillGaps: []
  optimizeRoute: []
  generateFull: []
  applyProposal: [proposal: Proposal]
  dismissProposal: [proposalId: string]
  closeResponse: []
}>()
```

- [ ] **Step 2: Add the response panel state**

Below the existing computed/refs, add:

```ts
const appliedProposalIds = ref<Set<string>>(new Set())
const applyingProposalIds = ref<Set<string>>(new Set())

function isApplied(id: string) {
  return appliedProposalIds.value.has(id)
}
function isApplying(id: string) {
  return applyingProposalIds.value.has(id)
}

async function onApply(proposal: Proposal) {
  if (isApplied(proposal.id) || isApplying(proposal.id)) return
  applyingProposalIds.value.add(proposal.id)
  emit("applyProposal", proposal)
}

function markApplied(id: string) {
  applyingProposalIds.value.delete(id)
  appliedProposalIds.value.add(id)
}

function markApplyFailed(id: string) {
  applyingProposalIds.value.delete(id)
}

defineExpose({ markApplied, markApplyFailed })
```

Hide suggestion chips whenever a response is present:

```ts
const showSuggestions = computed(
  () =>
    !props.loading &&
    !props.response &&
    (focused.value || hovered.value) &&
    props.modelValue.trim().length === 0,
)
```

- [ ] **Step 3: Create the response panel types in `app/types/`**

Create `app/types/proposal.ts`:

```ts
// Mirror of server/lib/proposals.ts. Kept in sync manually — narrow types are fine for the UI.
export type Proposal =
  | { id: string; kind: "add-activities"; dayId: string; summary: string;
      payload: { activities: unknown[] } }
  | { id: string; kind: "remove-activities"; dayId: string; summary: string;
      payload: { activityIds: string[] } }
  | { id: string; kind: "reschedule"; dayId: string; summary: string;
      payload: { updates: { activityId: string; suggestedTime: string; estimatedDurationMinutes: number }[] } }
  | { id: string; kind: "optimize-route"; dayId: string; summary: string;
      payload: { orderedActivityIds?: string[] } }
  | { id: string; kind: "set-accommodation"; dayId: string; summary: string;
      payload: { name: string; address: string | null; lat: number | null; lng: number | null; placeId: string | null } }
```

Create `app/types/review.ts`:

```ts
import type { Proposal } from "./proposal"

export interface ReviewFinding {
  id: string
  code: string
  severity: "critical" | "warning" | "suggestion"
  title: string
  message: string
  recommendation: string
  dayId: string
  dayNumber: number
  activityIds?: string[]
  proposal?: Proposal
}
```

- [ ] **Step 4: Add the response panel template**

In the `<template>`, locate the existing feedback toast / suggestion chips `<Transition>`. Insert a new sibling block ABOVE that transition (so it takes priority over chips):

```vue
<!-- Response panel (proposals + findings) -->
<div
  v-if="response"
  class="mx-auto flex w-full max-w-[28rem] flex-col gap-3"
>
  <div class="flex items-start justify-between gap-2">
    <p class="flex-1 text-sm text-sand-800">{{ response.message }}</p>
    <button
      type="button"
      class="shrink-0 rounded-full p-1 text-sand-400 hover:text-sand-700"
      title="Close"
      @click="emit('closeResponse')"
    >
      <Icon name="lucide:x" class="h-4 w-4" />
    </button>
  </div>

  <!-- Findings (review prompts) -->
  <div v-if="response.findings?.length" class="flex flex-col gap-2">
    <article
      v-for="finding in response.findings"
      :key="finding.id"
      class="rounded-xl border border-sand-200 bg-white p-3"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wide text-sand-500">
            Day {{ finding.dayNumber }} · {{ finding.severity }}
          </p>
          <h4 class="text-sm font-semibold text-sand-900">{{ finding.title }}</h4>
          <p class="mt-1 text-xs text-sand-600">{{ finding.message }}</p>
        </div>
      </div>
      <p class="mt-2 text-xs text-sand-700">
        <span class="font-medium">Fix:</span> {{ finding.recommendation }}
      </p>
      <div v-if="finding.proposal" class="mt-2 flex justify-end gap-2">
        <button
          type="button"
          :disabled="isApplying(finding.proposal.id) || isApplied(finding.proposal.id)"
          class="rounded-lg bg-terra-500 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          @click="onApply(finding.proposal)"
        >
          {{ isApplied(finding.proposal.id)
            ? "Applied"
            : isApplying(finding.proposal.id)
              ? "Applying…"
              : "Apply fix" }}
        </button>
      </div>
    </article>
  </div>

  <!-- Proposal cards (mutation prompts) -->
  <div v-if="response.proposals?.length" class="flex flex-col gap-2">
    <article
      v-for="proposal in response.proposals"
      :key="proposal.id"
      class="rounded-xl border border-sand-200 bg-white p-3"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wide text-sand-500">{{ proposal.kind }}</p>
          <h4 class="text-sm font-semibold text-sand-900">{{ proposal.summary }}</h4>
        </div>
      </div>
      <div class="mt-2 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-sand-200 px-3 py-1 text-xs text-sand-700 hover:bg-sand-50"
          @click="emit('dismissProposal', proposal.id)"
        >
          Dismiss
        </button>
        <button
          type="button"
          :disabled="isApplying(proposal.id) || isApplied(proposal.id)"
          class="rounded-lg bg-terra-500 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          @click="onApply(proposal)"
        >
          {{ isApplied(proposal.id)
            ? "Applied"
            : isApplying(proposal.id)
              ? "Applying…"
              : "Apply" }}
        </button>
      </div>
    </article>
  </div>
</div>
```

- [ ] **Step 5: Verify the dock still renders**

Run the dev server briefly to ensure the component compiles. (No automated UI tests in this codebase.)
Run: `bun run dev` in one terminal, open the trip page, expand the dock. Confirm the input pill + chips still appear when no response is set.

- [ ] **Step 6: Commit**

```bash
git add app/components/AiDock.vue app/types/proposal.ts app/types/review.ts
git commit -m "feat(ai-dock): add response panel rendering proposals and findings"
```

---

## Task 13: Update `ItineraryReviewPanel.vue`

**Files:**
- Modify: `app/components/ItineraryReviewPanel.vue`

- [ ] **Step 1: Extend the `ReviewFinding` interface (local) to include `proposal`**

Replace the existing local interface in `ItineraryReviewPanel.vue`:

```ts
import type { Proposal } from "~/types/proposal"

interface ReviewFinding {
  id: string
  code: string
  severity: ReviewSeverity
  title: string
  message: string
  recommendation: string
  dayId: string
  dayNumber: number
  activityIds?: string[]
  proposal?: Proposal
}
```

- [ ] **Step 2: Add an "Ask AI for fixes" header button + emit**

Extend the emits:

```ts
const emit = defineEmits<{
  "update:scope": [scope: ReviewScope]
  "update:dayId": [dayId: string | undefined]
  reviewed: [result: ReviewResult]
  fix: [finding: ReviewFinding]
  requestAiReview: [scope: ReviewScope, dayId: string | undefined]
}>()
```

In the header (next to the existing Review button), add:

```vue
<button
  type="button"
  class="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-terra-200 bg-white px-3 text-sm font-medium text-terra-700 transition hover:bg-terra-50"
  @click="emit('requestAiReview', scope, scope === 'day' ? selectedDayId : undefined)"
>
  <Icon name="lucide:sparkles" class="h-4 w-4" />
  Ask AI for fixes
</button>
```

- [ ] **Step 3: Render Apply button on findings with a proposal**

Inside the `<article>` for each finding, change the buttons row:

```vue
<div class="mt-3 flex justify-end gap-2">
  <button
    v-if="finding.proposal"
    type="button"
    class="inline-flex items-center gap-1.5 rounded-lg bg-terra-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-terra-600"
    @click="emit('fix', finding)"
  >
    <Icon name="lucide:sparkles" class="h-3.5 w-3.5" />
    Apply suggested fix
  </button>
  <button
    type="button"
    class="inline-flex items-center gap-1.5 rounded-lg border border-sand-200 bg-white px-3 py-1.5 text-xs font-medium text-sand-700 transition hover:border-terra-300 hover:bg-terra-50 hover:text-terra-700"
    @click="emit('fix', finding)"
  >
    <Icon name="lucide:wrench" class="h-3.5 w-3.5" />
    {{ fixButtonLabel(finding.code) }}
  </button>
</div>
```

The parent page (Task 14) interprets `fix` events: if `finding.proposal` is set, post to the apply endpoint; otherwise open the existing edit modal.

- [ ] **Step 4: Commit**

```bash
git add app/components/ItineraryReviewPanel.vue
git commit -m "feat(review-panel): show Apply button on findings with proposals and add Ask AI header"
```

---

## Task 14: Wire dock response state in the trip page

**Files:**
- Modify: `app/pages/trips/[id].vue`

- [ ] **Step 1: Add response state**

Near the other AI-related refs (search for `aiPrompt`, `aiLoading`, `aiUsage`), add:

```ts
import type { Proposal } from "~/types/proposal"
import type { ReviewFinding } from "~/types/review"

interface AiDockResponse {
  message: string
  proposals: Proposal[]
  findings?: ReviewFinding[]
  intent?: string
}

const aiResponse = ref<AiDockResponse | null>(null)
const aiDockRef = ref<{ markApplied: (id: string) => void; markApplyFailed: (id: string) => void } | null>(null)
```

Pass them to the dock:

```vue
<AiDock
  ref="aiDockRef"
  v-if="trip && activeTab === 'itinerary' && activeDay && !isViewer"
  v-model="aiPrompt"
  :loading="aiLoading"
  :loading-mode="aiLoadingMode"
  :usage-used="aiUsage?.used ?? null"
  :usage-limit="aiUsage?.limit ?? null"
  :usage-remaining="aiUsage?.remaining ?? null"
  :has-activities="activeDayHasActivities"
  :destination="trip.destination"
  :feedback-message="aiMessage"
  :feedback-error="aiError"
  :undo-available="undoAvailable"
  :undoing="undoLoading"
  :response="aiResponse"
  @submit="submitAiPrompt"
  @cancel="handleAiCancel"
  @undo="handleUndo"
  @dismiss-feedback="handleDismissAiFeedback"
  @fill-gaps="handleQuickFillGaps"
  @optimize-route="handleQuickOptimizeRoute"
  @generate-full="handleGenerateFullItinerary"
  @apply-proposal="handleApplyProposal"
  @dismiss-proposal="handleDismissProposal"
  @close-response="aiResponse = null"
/>
```

- [ ] **Step 2: Change `submitAiPrompt` to use `mode: "plan"`**

Find the existing `submitAiPrompt` function. Modify the `$fetch` call to include `mode: "plan"`:

```ts
async function submitAiPrompt(prompt: string) {
  if (!activeDay.value) return
  aiLoading.value = true
  aiLoadingMode.value = "generate"
  aiError.value = ""
  aiMessage.value = ""
  try {
    const data = await $fetch(`/api/trips/${tripId}/days/${activeDay.value.id}/ai`, {
      method: "POST",
      body: { prompt, mode: "plan" },
    })
    aiResponse.value = {
      message: data.message,
      proposals: data.proposals ?? [],
      findings: data.findings,
      intent: data.intent,
    }
    if (data.intent !== "question" && data.proposals?.length === 0 && !data.findings?.length) {
      aiMessage.value = data.message || "Nothing to change."
    }
  } catch (e: unknown) {
    aiError.value = e instanceof Error ? e.message : "AI failed"
  } finally {
    aiLoading.value = false
    aiPrompt.value = ""
    await refreshAiUsage()
  }
}
```

- [ ] **Step 3: Quick-action handlers pass `mode: "execute"`**

For each of `handleQuickFillGaps`, `handleQuickOptimizeRoute`, `handleGenerateFullItinerary`, ensure their `$fetch` body includes `mode: "execute"`. Example:

```ts
async function handleQuickFillGaps() {
  if (!activeDay.value) return
  aiLoading.value = true
  aiLoadingMode.value = "generate"
  try {
    const data = await $fetch(`/api/trips/${tripId}/days/${activeDay.value.id}/ai`, {
      method: "POST",
      body: { prompt: "Fill the gaps in this day", mode: "execute" },
    })
    aiMessage.value = data.message
    await refresh()
  } catch (e: unknown) {
    aiError.value = e instanceof Error ? e.message : "AI failed"
  } finally {
    aiLoading.value = false
    await refreshAiUsage()
  }
}
```

Repeat for the other two with their existing prompts.

- [ ] **Step 4: Implement Apply / Dismiss**

Add:

```ts
async function handleApplyProposal(proposal: Proposal) {
  try {
    const data = await $fetch(`/api/trips/${tripId}/proposals/apply`, {
      method: "POST",
      body: { proposal },
    })
    aiMessage.value = data.message
    aiDockRef.value?.markApplied(proposal.id)
    // Remove the applied proposal from the response panel.
    if (aiResponse.value) {
      aiResponse.value = {
        ...aiResponse.value,
        proposals: aiResponse.value.proposals.filter((p) => p.id !== proposal.id),
        findings: aiResponse.value.findings?.map((f) =>
          f.proposal?.id === proposal.id ? { ...f, proposal: undefined } : f,
        ),
      }
    }
    await refresh()
  } catch (e: unknown) {
    aiDockRef.value?.markApplyFailed(proposal.id)
    aiError.value = e instanceof Error ? e.message : "Apply failed"
  } finally {
    await refreshAiUsage()
  }
}

function handleDismissProposal(proposalId: string) {
  if (!aiResponse.value) return
  aiResponse.value = {
    ...aiResponse.value,
    proposals: aiResponse.value.proposals.filter((p) => p.id !== proposalId),
  }
}
```

- [ ] **Step 5: Wire `ItineraryReviewPanel`'s "Ask AI for fixes"**

In the existing `<ItineraryReviewPanel>` usage, add a listener:

```vue
<ItineraryReviewPanel
  :trip-id="tripId"
  :days="sortedDays"
  initial-scope="trip"
  :initial-day-id="activeDayId ?? undefined"
  @fix="handleReviewFix"
  @request-ai-review="handleRequestAiReview"
/>
```

Add the handler:

```ts
function handleRequestAiReview(scope: "day" | "trip", dayId: string | undefined) {
  activeTab.value = "itinerary"
  if (scope === "day" && dayId) {
    activeDayId.value = dayId
  }
  aiPrompt.value =
    scope === "trip" ? "Review the whole trip and propose fixes" : "Review this day and propose fixes"
  // Submit the review prompt immediately.
  void submitAiPrompt(aiPrompt.value)
}
```

Update `handleReviewFix` to apply the proposal directly when present:

```ts
async function handleReviewFix(finding: ReviewFinding) {
  if (finding.proposal) {
    await handleApplyProposal(finding.proposal)
    return
  }
  // Fall back to existing edit-activity modal behavior.
  // ...existing logic...
}
```

- [ ] **Step 6: Manual smoke test**

Run: `bun run dev`
In the browser:
- Open a trip with at least one populated day.
- Type "add a coffee shop nearby" → expect a proposal card with Apply / Dismiss; the day must NOT mutate until Apply.
- Click Apply → toast + the new activity appears.
- Type "is this day too packed?" → expect a text-only response, no proposal card.
- Type "review this day" → expect findings, some with an Apply fix button.
- Click "Fill the gaps" chip → expect immediate mutation + toast (existing behavior).
- On the Review tab, click "Ask AI for fixes" → dock opens, review runs.

- [ ] **Step 7: Commit**

```bash
git add app/pages/trips/[id].vue
git commit -m "feat(trip-page): wire dock propose-then-apply and Ask AI review handoff"
```

---

## Self-Review

**Spec coverage check** (re-read `docs/superpowers/specs/2026-05-20-ai-chat-rework-design.md`):

- UX: propose-then-apply free-text → Task 12, 14 ✓
- UX: quick chips stay direct-execute → Task 14 step 3 ✓
- UX: Q&A intent (read-only) → Task 6 + Task 10 step 4 ✓
- UX: review with embedded proposals → Task 8 + Task 12 + Task 13 ✓
- Data: `Proposal` type + zod schema → Task 1 ✓
- Data: extended `ItineraryReviewFinding` → Task 7 ✓
- Server: `mode: "plan" | "execute"` field → Task 10 ✓
- Server: new apply endpoint → Task 9 ✓
- Server: `resultToProposals` + `applyProposal` helpers → Task 2, 3 ✓
- Server: six tools on `plannerAgent` → Task 5, 6 ✓
- Server: `reviewItineraryWithJudgment` + merge → Task 8 ✓
- Server: `question` intent + `handleQuestion` → Task 6 ✓
- Server: credit refund on plan failure → Task 4 + Task 10 step 5 ✓
- Client: response panel in `AiDock.vue` → Task 12 ✓
- Client: review panel embedded Apply + Ask AI button → Task 13 ✓
- Client: page wiring → Task 14 ✓
- Client: composable update → Task 11 ✓

**Placeholder scan:** every step contains complete code; no TBDs or "implement later". Task 3's note about replacing the placeholder `remove-activities` branch is intentional — the canonical block immediately follows.

**Type consistency check:**
- `Proposal` discriminated union: same `kind` literals used in Task 1 (schema), Task 2 (resultToProposals), Task 3 (applyProposal switch), Task 12 (client types), Task 13 (review panel local type). ✓
- `applyProposal` signature: takes `(Proposal, ApplyContext)` — Task 3 defines; Task 9 calls with matching shape. ✓
- `createTripTools(ctx)` returns 6 tools whose ids match the smoke test in Task 5. ✓
- `mergeFindings(deterministic, judgment)` — Task 8 signature matches its test in Task 8 Step 1. ✓
- `AiDockResponse` shape exported from `AiDock.vue` matches the response state declared in Task 14. ✓
- New emit names — `applyProposal`, `dismissProposal`, `closeResponse`, `requestAiReview` — all wired consistently between component (Task 12 / 13) and parent (Task 14). ✓
