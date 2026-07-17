import assert from "node:assert/strict"
import { describe, it, beforeEach } from "node:test"
import { ref } from "vue"

type FetchCall = { url: string; body: Record<string, unknown> }

const calls: FetchCall[] = []
let fetchImpl: (url: string, opts: { body: Record<string, unknown> }) => Promise<unknown>
let confirmAnswer = true

// Nuxt auto-imports resolve to globals at call time; stub them before import.
const g = globalThis as unknown as {
  $fetch: unknown
  useConfirm: unknown
  ref: unknown
}
g.ref = ref
g.$fetch = (url: string, opts: { body: Record<string, unknown> }) => {
  calls.push({ url, body: opts.body })
  return fetchImpl(url, opts)
}
g.useConfirm = () => ({ confirm: async () => confirmAnswer })

const { useGenerateFullItinerary } = await import("./useGenerateFullItinerary")

const days = [
  { id: "d1", dayNumber: 1, activities: [] },
  { id: "d2", dayNumber: 2, activities: [{ id: "a1" }] },
  { id: "d3", dayNumber: 3, activities: [] },
]

const outlineResponse = {
  outline: {
    days: [
      {
        dayId: "d1",
        dayNumber: 1,
        theme: "Easy arrival",
        focusArea: "Gion",
        mustInclude: ["Nishiki Market"],
        guidance: "Land late — one bite only.",
      },
      {
        dayId: "d3",
        dayNumber: 3,
        theme: "Temples and tea",
        focusArea: "Higashiyama",
        mustInclude: [],
        guidance: "Start at 10:00.",
      },
    ],
    avoidRepeats: ["Fushimi Inari"],
  },
}

function httpError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })
}

beforeEach(() => {
  calls.length = 0
  confirmAnswer = true
  fetchImpl = async (url) => (url.endsWith("/generate-outline") ? outlineResponse : { ok: true })
})

describe("useGenerateFullItinerary", () => {
  it("returns false and calls nothing when there are no empty days", async () => {
    const { run } = useGenerateFullItinerary("t1")
    assert.equal(await run([{ id: "d2", dayNumber: 2, activities: [{ id: "a1" }] }], 10), false)
    assert.equal(calls.length, 0)
  })

  it("returns false without spending anything when the confirm is cancelled", async () => {
    confirmAnswer = false
    const { run } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), false)
    assert.equal(calls.length, 0)
  })

  it("fetches the outline, then generates each empty day with its outline prompt", async () => {
    const { run, errorMessage } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)

    assert.equal(calls.length, 3)
    assert.equal(calls[0]?.url, "/api/trips/t1/generate-outline")
    assert.equal(calls[1]?.url, "/api/trips/t1/days/d1/ai")
    assert.equal(calls[2]?.url, "/api/trips/t1/days/d3/ai")

    assert.match(String(calls[1]?.body.prompt), /Easy arrival/)
    assert.match(String(calls[1]?.body.prompt), /Nishiki Market/)
    assert.match(String(calls[1]?.body.prompt), /Fushimi Inari/)
    assert.equal(calls[1]?.body.intent, "fill_gaps")
    assert.match(String(calls[2]?.body.prompt), /Temples and tea/)
    assert.equal(errorMessage.value, "")
  })

  it("skips the outline call and uses generic prompts when credits are scarce", async () => {
    const { run } = useGenerateFullItinerary("t1")
    await run(days, 2) // 2 empty days need 3 prompts; only 2 left
    assert.ok(!calls.some((c) => c.url.endsWith("/generate-outline")))
    assert.equal(calls.length, 2)
    assert.match(String(calls[0]?.body.prompt), /good mix of activities/)
  })

  it("falls back to generic prompts and sets a notice when the outline fails", async () => {
    fetchImpl = async (url) => {
      if (url.endsWith("/generate-outline")) throw httpError(502)
      return { ok: true }
    }
    const { run, noticeMessage, errorMessage } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)
    assert.equal(calls.length, 3) // outline attempt + both days still generated
    assert.match(String(calls[1]?.body.prompt), /good mix of activities/)
    assert.match(noticeMessage.value, /without trip-level planning/i)
    assert.equal(errorMessage.value, "")
  })

  it("treats a 200 with zero outline days as a failure for notice purposes", async () => {
    fetchImpl = async (url) => {
      if (url.endsWith("/generate-outline")) return { outline: { days: [], avoidRepeats: [] } }
      return { ok: true }
    }
    const { run, noticeMessage, errorMessage } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)
    assert.equal(calls.length, 3) // outline attempt + both days still generated
    assert.match(String(calls[1]?.body.prompt), /good mix of activities/)
    assert.match(String(calls[2]?.body.prompt), /good mix of activities/)
    assert.match(noticeMessage.value, /without trip-level planning/i)
    assert.equal(errorMessage.value, "")
  })

  it("uses the outline for days it covers and falls back to generic for a partial outline, without a notice", async () => {
    fetchImpl = async (url) => {
      if (url.endsWith("/generate-outline")) {
        return {
          outline: {
            days: [
              {
                dayId: "d1",
                dayNumber: 1,
                theme: "Easy arrival",
                focusArea: "Gion",
                mustInclude: [],
                guidance: "",
              },
            ],
            avoidRepeats: [],
          },
        }
      }
      return { ok: true }
    }
    const { run, noticeMessage, errorMessage } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)
    assert.match(String(calls[1]?.body.prompt), /Easy arrival/)
    assert.match(String(calls[2]?.body.prompt), /good mix of activities/)
    assert.equal(noticeMessage.value, "")
    assert.equal(errorMessage.value, "")
  })

  it("retries a day once with the generic prompt on a 400", async () => {
    let d1Attempts = 0
    fetchImpl = async (url) => {
      if (url.endsWith("/generate-outline")) return outlineResponse
      if (url.endsWith("/days/d1/ai")) {
        d1Attempts++
        if (d1Attempts === 1) throw httpError(400)
      }
      return { ok: true }
    }
    const { run, errorMessage } = useGenerateFullItinerary("t1")
    await run(days, 10)
    assert.equal(d1Attempts, 2)
    const retry = calls.filter((c) => c.url.endsWith("/days/d1/ai"))[1]
    assert.match(String(retry?.body.prompt), /good mix of activities/)
    assert.equal(errorMessage.value, "")
  })

  it("continues past a failed day and reports the failures at the end", async () => {
    fetchImpl = async (url) => {
      if (url.endsWith("/generate-outline")) return outlineResponse
      if (url.endsWith("/days/d1/ai")) throw httpError(502)
      return { ok: true }
    }
    const { run, errorMessage, running } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)
    assert.ok(
      calls.some((c) => c.url.endsWith("/days/d3/ai")),
      "day 3 must still run",
    )
    assert.match(errorMessage.value, /Day 1/)
    assert.equal(running.value, false)
  })

  it("processes days in ascending dayNumber order regardless of input order", async () => {
    const reversedDays = [
      { id: "d3", dayNumber: 3, activities: [] },
      { id: "d2", dayNumber: 2, activities: [] },
      { id: "d1", dayNumber: 1, activities: [] },
    ]
    const { run } = useGenerateFullItinerary("t1")
    await run(reversedDays, 10)
    const dayAiCalls = calls.filter((c) => c.url.includes("/days/")).map((c) => c.url)
    assert.deepEqual(dayAiCalls, [
      "/api/trips/t1/days/d1/ai",
      "/api/trips/t1/days/d2/ai",
      "/api/trips/t1/days/d3/ai",
    ])
  })

  it("sets totalDays from the plan before the outline fetch resolves", async () => {
    let totalDaysDuringOutlineFetch: number | undefined
    const state = useGenerateFullItinerary("t1")
    fetchImpl = async (url) => {
      if (url.endsWith("/generate-outline")) {
        totalDaysDuringOutlineFetch = state.totalDays.value
        return outlineResponse
      }
      return { ok: true }
    }
    await state.run(days, 10)
    assert.equal(totalDaysDuringOutlineFetch, 2)
  })

  it("exposes progress: total days and a themed label per day", async () => {
    const labels: string[] = []
    fetchImpl = async (url) => {
      if (url.endsWith("/generate-outline")) return outlineResponse
      labels.push(state.currentDayLabel.value)
      return { ok: true }
    }
    const state = useGenerateFullItinerary("t1")
    await state.run(days, 10)
    assert.equal(state.totalDays.value, 2)
    assert.deepEqual(labels, ["Day 1 — Easy arrival", "Day 3 — Temples and tea"])
  })
})
