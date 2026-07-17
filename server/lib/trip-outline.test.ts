import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  buildTripOutline,
  MAX_AVOID_REPEATS,
  MAX_MUST_INCLUDE,
  type TripOutlineInput,
  type TripOutlineRaw,
} from "./trip-outline"

const input: TripOutlineInput = {
  destination: "Kyoto, Japan",
  startDate: "2026-09-01",
  endDate: "2026-09-03",
  preferences: { pace: "relaxed", budget: "moderate", interests: ["temples"] },
  tripNotes: "We hate early mornings.",
  savedIdeas: [
    { name: "Nishiki Market", type: "attraction", description: "Food street" },
    { name: "Kichi Kichi", type: "restaurant", description: null },
  ],
  days: [
    { dayId: "d1", dayNumber: 1, date: "2026-09-01", isEmpty: true, existingActivityNames: [] },
    {
      dayId: "d2",
      dayNumber: 2,
      date: "2026-09-02",
      isEmpty: false,
      existingActivityNames: ["Fushimi Inari"],
    },
    { dayId: "d3", dayNumber: 3, date: "2026-09-03", isEmpty: true, existingActivityNames: [] },
  ],
  flights: [
    {
      departureAirport: "SIN",
      arrivalAirport: "KIX",
      departureTime: "2026-08-31T18:00:00Z",
      arrivalTime: "2026-09-01T22:10:00Z",
    },
  ],
}

function rawOutline(overrides: Partial<TripOutlineRaw> = {}): TripOutlineRaw {
  return {
    days: [
      {
        dayNumber: 1,
        theme: "Easy arrival evening",
        focusArea: "Gion",
        mustInclude: ["Nishiki Market"],
        guidance: "Land 22:10 — keep it to one late bite.",
      },
      {
        dayNumber: 3,
        theme: "Temples and tea",
        focusArea: "Higashiyama",
        mustInclude: ["Kichi Kichi"],
        guidance: "Start at 10:00.",
      },
    ],
    avoidRepeats: ["Fushimi Inari"],
    ...overrides,
  }
}

function capture() {
  const seen: { prompt: string; system: string }[] = []
  return {
    seen,
    generate: async (args: { prompt: string; system: string }) => {
      seen.push(args)
      return rawOutline()
    },
  }
}

describe("buildTripOutline", () => {
  it("maps dayNumber to dayId and returns entries only for empty days", async () => {
    const outline = await buildTripOutline(input, { generate: async () => rawOutline() })
    assert.deepEqual(
      outline.days.map((d) => [d.dayNumber, d.dayId]),
      [
        [1, "d1"],
        [3, "d3"],
      ],
    )
  })

  it("drops entries for non-empty days and unknown day numbers", async () => {
    const outline = await buildTripOutline(input, {
      generate: async () =>
        rawOutline({
          days: [
            { dayNumber: 2, theme: "t", focusArea: "f", mustInclude: [], guidance: "g" },
            { dayNumber: 99, theme: "t", focusArea: "f", mustInclude: [], guidance: "g" },
            { dayNumber: 1, theme: "keep", focusArea: "f", mustInclude: [], guidance: "g" },
          ],
        }),
    })
    assert.equal(outline.days.length, 1)
    assert.equal(outline.days[0]?.theme, "keep")
  })

  it("caps mustInclude at 3 per day", async () => {
    const outline = await buildTripOutline(input, {
      generate: async () =>
        rawOutline({
          days: [
            {
              dayNumber: 1,
              theme: "t",
              focusArea: "f",
              guidance: "g",
              mustInclude: ["a", "b", "c", "d", "e"],
            },
          ],
        }),
    })
    assert.equal(outline.days[0]?.mustInclude.length, MAX_MUST_INCLUDE)
    assert.deepEqual(outline.days[0]?.mustInclude, ["a", "b", "c"])
  })

  it("caps avoidRepeats at 60 entries", async () => {
    const many = Array.from({ length: 200 }, (_, i) => `Venue ${i}`)
    const outline = await buildTripOutline(input, {
      generate: async () => rawOutline({ avoidRepeats: many }),
    })
    assert.equal(outline.avoidRepeats.length, MAX_AVOID_REPEATS)
  })

  it("includes days, existing activity names, saved ideas, notes and flights in the prompt", async () => {
    const { seen, generate } = capture()
    await buildTripOutline(input, { generate })
    const prompt = seen[0]?.prompt ?? ""
    assert.match(prompt, /Kyoto, Japan/)
    assert.match(prompt, /Day 1 \(2026-09-01, Tuesday\)/)
    assert.match(prompt, /EMPTY/)
    assert.match(prompt, /Fushimi Inari/) // existing activity on the non-empty day
    assert.match(prompt, /Nishiki Market/) // saved idea
    assert.match(prompt, /early mornings/) // trip notes
    assert.match(prompt, /RELAXED PACE/) // formatPreferences output
    assert.match(prompt, /SIN → KIX/) // flights
    assert.match(prompt, /2026-09-01T22:10:00Z/) // arrival time drives pacing
  })

  it("asks only for the empty days in the prompt instructions", async () => {
    const { seen, generate } = capture()
    await buildTripOutline(input, { generate })
    assert.match(seen[0]?.prompt ?? "", /ONLY these day numbers: 1, 3/)
  })

  it("retries exactly once before failing", async () => {
    let calls = 0
    const outline = await buildTripOutline(input, {
      generate: async () => {
        calls++
        if (calls === 1) throw new Error("schema validation failed")
        return rawOutline()
      },
    })
    assert.equal(calls, 2)
    assert.equal(outline.days.length, 2)
  })

  it("rethrows when both attempts fail", async () => {
    await assert.rejects(
      buildTripOutline(input, {
        generate: async () => {
          throw new Error("model down")
        },
      }),
      /model down/,
    )
  })
})
