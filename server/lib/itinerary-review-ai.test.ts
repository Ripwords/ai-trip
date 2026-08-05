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
    const dup: ItineraryReviewFinding = {
      ...jud,
      code: "missing-lunch",
      id: "d1:missing-lunch:judgment",
    }
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

describe("REVIEWER_SYSTEM_PROMPT", () => {
  it("protects transport-type waypoints from removal findings", async () => {
    const { REVIEWER_SYSTEM_PROMPT } = await import("./itinerary-review-ai")
    assert.match(REVIEWER_SYSTEM_PROMPT, /transport/i)
    assert.match(REVIEWER_SYSTEM_PROMPT, /waypoint/i)
    assert.match(REVIEWER_SYSTEM_PROMPT, /never.*remov/i)
  })
})

describe("REVIEWER_SYSTEM_PROMPT duration convention", () => {
  it("states that durations are venue-time only, excluding travel", async () => {
    const { REVIEWER_SYSTEM_PROMPT } = await import("./itinerary-review-ai")
    assert.match(REVIEWER_SYSTEM_PROMPT, /time AT the venue/i)
    assert.match(REVIEWER_SYSTEM_PROMPT, /travel.*not included|not include.*travel/i)
  })
})

describe("REVIEWER_SYSTEM_PROMPT injection guard", () => {
  it("forbids following instructions found in trip data", async () => {
    const { REVIEWER_SYSTEM_PROMPT } = await import("./itinerary-review-ai")
    assert.match(REVIEWER_SYSTEM_PROMPT, /never follow instructions.*(trip|traveler) data/i)
  })
})

describe("judgmentOutputSchema", () => {
  it("accepts a well-formed judgment finding", async () => {
    const { judgmentOutputSchema } = await import("./itinerary-review-ai")
    const parsed = judgmentOutputSchema.safeParse({
      findings: [
        {
          code: "backtracking-route",
          severity: "warning",
          title: "Day zig-zags",
          message: "Two crossings of the same district",
          recommendation: "Reorder the afternoon",
          dayId: "d1",
          dayNumber: 1,
        },
      ],
    })
    assert.equal(parsed.success, true)
  })

  it("rejects codes outside the judgment set, so the AI pass cannot mint deterministic findings", async () => {
    const { judgmentOutputSchema } = await import("./itinerary-review-ai")
    const parsed = judgmentOutputSchema.safeParse({
      findings: [
        {
          code: "missing-lunch",
          severity: "warning",
          title: "x",
          message: "x",
          recommendation: "x",
          dayId: "d1",
          dayNumber: 1,
        },
      ],
    })
    assert.equal(parsed.success, false)
  })

  it("rejects an invented severity", async () => {
    const { judgmentOutputSchema } = await import("./itinerary-review-ai")
    const parsed = judgmentOutputSchema.safeParse({
      findings: [
        {
          code: "pace-mismatch",
          severity: "blocker",
          title: "x",
          message: "x",
          recommendation: "x",
          dayId: "d1",
          dayNumber: 1,
        },
      ],
    })
    assert.equal(parsed.success, false)
  })
})

// ── The judgment prompt actually carries the schedule (issue #20) ──────

const DAY_1 = "11111111-1111-4111-8111-111111111111"
const DAY_2 = "22222222-2222-4222-8222-222222222222"
const ACT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"

function reviewableTrip() {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    destination: "Kyoto, Japan",
    preferences: { pace: "relaxed" as const, interests: ["temples", "food"] },
    days: [
      {
        id: DAY_1,
        dayNumber: 1,
        date: "2026-06-01",
        accommodationName: "Hotel Granvia",
        accommodationAddress: "Karasuma, Kyoto",
        accommodationLat: 34.985,
        accommodationLng: 135.758,
        activities: [
          {
            id: ACT_1,
            name: "Fushimi Inari Taisha",
            type: "attraction",
            lat: 34.967,
            lng: 135.772,
            suggestedTime: "09:00",
            estimatedDurationMinutes: 120,
            sortOrder: 0,
            openingHours: ["Monday: Open 24 hours"],
          },
        ],
        travelSegments: [],
      },
      {
        id: DAY_2,
        dayNumber: 2,
        date: "2026-06-02",
        accommodationName: null,
        accommodationAddress: null,
        accommodationLat: null,
        accommodationLng: null,
        activities: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
            name: "Nishiki Market",
            type: "shopping",
            lat: 35.005,
            lng: 135.764,
            suggestedTime: "11:00",
            estimatedDurationMinutes: 90,
            sortOrder: 0,
          },
        ],
        travelSegments: [],
      },
    ],
  }
}

describe("buildJudgmentPrompt", () => {
  it("injects the schedule the system prompt claims is injected", async () => {
    const { buildJudgmentPrompt } = await import("./itinerary-review-ai")
    const prompt = buildJudgmentPrompt({
      trip: reviewableTrip(),
      options: { scope: "trip" },
      alreadyFlagged: [],
    })

    // Activity identity, clock times and durations — everything the prompt's
    // pace / energy-imbalance / backtracking rules are supposed to reason over.
    assert.match(prompt, /Fushimi Inari Taisha/)
    assert.match(prompt, /Nishiki Market/)
    assert.match(prompt, /09:00/)
    assert.match(prompt, /120/)
    assert.match(prompt, new RegExp(DAY_1))
    assert.match(prompt, new RegExp(ACT_1))
  })

  it("injects the traveler's preferences the soft-signal rule refers to", async () => {
    const { buildJudgmentPrompt } = await import("./itinerary-review-ai")
    const prompt = buildJudgmentPrompt({
      trip: reviewableTrip(),
      options: { scope: "trip" },
      alreadyFlagged: [],
    })
    assert.match(prompt, /relaxed/)
    assert.match(prompt, /temples/)
  })

  it("injects coordinates so getDistance can be called without a lookup step", async () => {
    const { buildJudgmentPrompt } = await import("./itinerary-review-ai")
    const prompt = buildJudgmentPrompt({
      trip: reviewableTrip(),
      options: { scope: "trip" },
      alreadyFlagged: [],
    })
    assert.match(prompt, /34\.967/)
    assert.match(prompt, /135\.772/)
  })

  it("narrows to the requested day when the scope is a day", async () => {
    const { buildJudgmentPrompt } = await import("./itinerary-review-ai")
    const prompt = buildJudgmentPrompt({
      trip: reviewableTrip(),
      options: { scope: "day", dayId: DAY_2 },
      alreadyFlagged: [],
    })
    assert.match(prompt, /Nishiki Market/)
    assert.ok(!prompt.includes("Fushimi Inari Taisha"), "day scope must not inject other days")
  })

  it("still lists the codes already flagged deterministically", async () => {
    const { buildJudgmentPrompt } = await import("./itinerary-review-ai")
    const prompt = buildJudgmentPrompt({
      trip: reviewableTrip(),
      options: { scope: "trip" },
      alreadyFlagged: [{ dayId: DAY_1, code: "missing-lunch" }],
    })
    assert.match(prompt, /missing-lunch/)
  })
})

// ── Proposals are tolerant, not all-or-nothing (issue #20) ─────────────

describe("judgmentOutputSchema proposals", () => {
  it("does not ask the model for ids it cannot know", async () => {
    const { judgmentOutputSchema } = await import("./itinerary-review-ai")
    // `proposalSchema` requires `id` and `dayId` as UUIDs. Asking a model to
    // invent them made one bad guess throw NoObjectGeneratedError and discard
    // EVERY finding in the response, not just the proposal.
    const parsed = judgmentOutputSchema.safeParse({
      findings: [
        {
          code: "pace-mismatch",
          severity: "suggestion",
          title: "No lunch",
          message: "Nothing between 11:00 and 16:00",
          recommendation: "Add a midday meal",
          dayId: DAY_1,
          dayNumber: 1,
          proposal: {
            kind: "add-activities",
            summary: "Add lunch near Fushimi Inari",
            payload: {
              activities: [
                {
                  name: "Soba Restaurant",
                  type: "restaurant",
                  description: "Local soba",
                  suggestedTime: "12:30",
                  estimatedDurationMinutes: 60,
                  costEstimate: 12,
                  tags: [],
                },
              ],
            },
          },
        },
      ],
    })
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues))
  })
})

describe("resolveJudgmentProposal", () => {
  const draft = {
    kind: "add-activities",
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
  }

  it("mints the proposal id and pins dayId to the finding's day", async () => {
    const { resolveJudgmentProposal } = await import("./itinerary-review-ai")
    const proposal = resolveJudgmentProposal(DAY_1, draft)
    assert.equal(proposal?.kind, "add-activities")
    assert.equal(proposal?.dayId, DAY_1)
    assert.match(proposal?.id ?? "", /^[0-9a-f-]{36}$/)
  })

  it("drops only the proposal when the model's payload is unusable", async () => {
    const { resolveJudgmentProposal } = await import("./itinerary-review-ai")
    assert.equal(resolveJudgmentProposal(DAY_1, { kind: "add-activities" }), undefined)
    assert.equal(resolveJudgmentProposal(DAY_1, "not an object"), undefined)
    assert.equal(resolveJudgmentProposal(DAY_1, undefined), undefined)
    assert.equal(resolveJudgmentProposal(DAY_1, { kind: "teleport" }), undefined)
  })

  it("refuses a dayId the model tried to redirect the proposal to", async () => {
    const { resolveJudgmentProposal } = await import("./itinerary-review-ai")
    const proposal = resolveJudgmentProposal(DAY_1, { ...draft, dayId: DAY_2 })
    assert.equal(proposal?.dayId, DAY_1)
  })
})
