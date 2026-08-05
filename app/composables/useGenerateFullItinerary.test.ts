import assert from "node:assert/strict"
import { describe, it, beforeEach } from "node:test"
import { ref } from "vue"

type FetchCall = { url: string; method: string; body: Record<string, unknown> }

const calls: FetchCall[] = []
let fetchImpl: (url: string, opts: { method?: string; body?: unknown }) => Promise<unknown>
let confirmAnswer = true
const confirms: { title: string; message: string }[] = []

// Nuxt auto-imports resolve to globals at call time; stub them before import.
const g = globalThis as unknown as {
  $fetch: unknown
  useConfirm: unknown
  ref: unknown
}
g.ref = ref
g.$fetch = (url: string, opts: { method?: string; body?: Record<string, unknown> } = {}) => {
  calls.push({
    url,
    method: opts.method ?? "GET",
    body: opts.body ?? {},
  })
  return fetchImpl(url, opts)
}
g.useConfirm = () => ({
  confirm: async (c: { title: string; message: string }) => {
    confirms.push(c)
    return confirmAnswer
  },
})

const { useGenerateFullItinerary } = await import("./useGenerateFullItinerary")

const days = [
  { id: "d1", dayNumber: 1, activities: [] },
  { id: "d2", dayNumber: 2, activities: [{ id: "a1" }] },
  { id: "d3", dayNumber: 3, activities: [] },
]

const outline = {
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
}

function aiUsage(remaining: number) {
  return { used: 100 - remaining, limit: 100, remaining }
}

/** Shape of POST /generation-run, with sensible defaults per test. */
function startResponse(over: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    mode: "outline",
    outline,
    days: [],
    remaining: [
      { dayId: "d1", dayNumber: 1 },
      { dayId: "d3", dayNumber: 3 },
    ],
    summary: { total: 2, generated: 0, failed: 0, remaining: 2, creditsCharged: 1 },
    resumed: false,
    aiUsage: aiUsage(9),
    ...over,
  }
}

function stateResponse(run: Record<string, unknown> | null, remaining = 10) {
  return { run, aiUsage: aiUsage(remaining) }
}

function httpError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })
}

const isRunUrl = (url: string) => url.endsWith("/generation-run")

beforeEach(() => {
  calls.length = 0
  confirms.length = 0
  confirmAnswer = true
  fetchImpl = async (url, opts) => {
    if (isRunUrl(url)) {
      if (opts.method === "POST") return startResponse()
      if (opts.method === "DELETE") return { cancelled: true }
      return stateResponse(null)
    }
    return { ok: true }
  }
})

const dayCalls = () => calls.filter((c) => c.url.includes("/days/"))

describe("useGenerateFullItinerary", () => {
  it("returns false and starts nothing when there are no empty days", async () => {
    const { run } = useGenerateFullItinerary("t1")
    assert.equal(await run([{ id: "d2", dayNumber: 2, activities: [{ id: "a1" }] }], 10), false)
    assert.equal(
      calls.filter((c) => c.method !== "GET").length,
      0,
      "a peek is free, but nothing may be started",
    )
  })

  it("returns false without spending anything when the confirm is cancelled", async () => {
    confirmAnswer = false
    const { run } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), false)
    assert.equal(
      calls.filter((c) => c.method === "POST").length,
      0,
      "cancelling must not create a run",
    )
  })

  it("starts a run, then generates each remaining day with its outline prompt and runId", async () => {
    const { run, errorMessage } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)

    const start = calls.find((c) => c.method === "POST")
    assert.equal(start?.url, "/api/trips/t1/generation-run")
    assert.equal(start?.body.skipOutline, false)
    assert.deepEqual(
      dayCalls().map((c) => c.url),
      ["/api/trips/t1/days/d1/ai", "/api/trips/t1/days/d3/ai"],
    )

    assert.match(String(dayCalls()[0]?.body.prompt), /Easy arrival/)
    assert.match(String(dayCalls()[0]?.body.prompt), /Nishiki Market/)
    assert.match(String(dayCalls()[0]?.body.prompt), /Fushimi Inari/)
    assert.equal(dayCalls()[0]?.body.intent, "fill_gaps")
    assert.equal(dayCalls()[0]?.body.runId, "run-1", "every day must be bound to the run")
    assert.match(String(dayCalls()[1]?.body.prompt), /Temples and tea/)
    assert.equal(errorMessage.value, "")
  })

  it("asks the server to skip the plan when credits can't cover plan + days", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") {
          return startResponse({
            mode: "generic",
            outline: null,
            summary: { total: 2, generated: 0, failed: 0, remaining: 2, creditsCharged: 0 },
            aiUsage: aiUsage(2),
          })
        }
        return stateResponse(null, 2)
      }
      return { ok: true }
    }
    const { run, noticeMessage } = useGenerateFullItinerary("t1")
    await run(days, 2) // 2 empty days need 3 prompts; only 2 left

    const post = calls.find((c) => c.method === "POST")
    assert.equal(post?.body.skipOutline, true)
    assert.equal(dayCalls().length, 2)
    assert.match(String(dayCalls()[0]?.body.prompt), /good mix of activities/)
    assert.equal(
      noticeMessage.value,
      "",
      "deliberately skipping the plan is not a degraded outline",
    )
  })

  it("falls back to generic prompts and sets a notice when the server returns no outline", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") return startResponse({ mode: "generic", outline: null })
        return stateResponse(null)
      }
      return { ok: true }
    }
    const { run, noticeMessage, errorMessage } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)
    assert.equal(dayCalls().length, 2, "both days still generate")
    assert.match(String(dayCalls()[0]?.body.prompt), /good mix of activities/)
    assert.match(noticeMessage.value, /without trip-level planning/i)
    assert.equal(errorMessage.value, "")
  })

  it("uses the outline where it covers a day and generic elsewhere, without a notice", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") {
          return startResponse({
            outline: { days: [outline.days[0]], avoidRepeats: [] },
          })
        }
        return stateResponse(null)
      }
      return { ok: true }
    }
    const { run, noticeMessage, errorMessage } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)
    assert.match(String(dayCalls()[0]?.body.prompt), /Easy arrival/)
    assert.match(String(dayCalls()[1]?.body.prompt), /good mix of activities/)
    assert.equal(noticeMessage.value, "")
    assert.equal(errorMessage.value, "")
  })

  it("retries a day once with the generic prompt on a 400", async () => {
    let d1Attempts = 0
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") return startResponse()
        return stateResponse(null)
      }
      if (url.endsWith("/days/d1/ai")) {
        d1Attempts++
        if (d1Attempts === 1) throw httpError(400)
      }
      return { ok: true }
    }
    const { run, errorMessage } = useGenerateFullItinerary("t1")
    await run(days, 10)
    assert.equal(d1Attempts, 2)
    const retry = dayCalls().filter((c) => c.url.endsWith("/days/d1/ai"))[1]
    assert.match(String(retry?.body.prompt), /good mix of activities/)
    assert.equal(retry?.body.runId, "run-1")
    assert.equal(errorMessage.value, "")
  })

  it("continues past a failed day and points the traveler at a free retry", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") return startResponse()
        return stateResponse(null)
      }
      if (url.endsWith("/days/d1/ai")) throw httpError(502)
      return { ok: true }
    }
    const { run, errorMessage, running } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)
    assert.ok(
      dayCalls().some((c) => c.url.endsWith("/days/d3/ai")),
      "day 3 must still run",
    )
    assert.match(errorMessage.value, /Day 1 failed/)
    assert.match(errorMessage.value, /won't be charged for the days that worked/)
    assert.equal(running.value, false)
  })

  it("does not count a 409 as a failure — another tab owns that day", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") return startResponse()
        return stateResponse(null)
      }
      if (url.endsWith("/days/d1/ai")) throw httpError(409)
      return { ok: true }
    }
    const { run, errorMessage, creditsSpent } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)
    assert.equal(errorMessage.value, "", "a day owned by another tab is not this run's failure")
    assert.equal(creditsSpent.value, 2, "1 outline + 1 day actually generated, not 3")
  })

  it("generates the days the server returns, in the order it returns them", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") {
          return startResponse({
            remaining: [
              { dayId: "d1", dayNumber: 1 },
              { dayId: "d2", dayNumber: 2 },
              { dayId: "d3", dayNumber: 3 },
            ],
          })
        }
        return stateResponse(null)
      }
      return { ok: true }
    }
    const { run } = useGenerateFullItinerary("t1")
    await run(
      [
        { id: "d3", dayNumber: 3, activities: [] },
        { id: "d2", dayNumber: 2, activities: [] },
        { id: "d1", dayNumber: 1, activities: [] },
      ],
      10,
    )
    assert.deepEqual(
      dayCalls().map((c) => c.url),
      ["/api/trips/t1/days/d1/ai", "/api/trips/t1/days/d2/ai", "/api/trips/t1/days/d3/ai"],
    )
  })

  it("sets totalDays from the plan before the run request resolves", async () => {
    let totalDuringStart: number | undefined
    const state = useGenerateFullItinerary("t1")
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") {
          totalDuringStart = state.totalDays.value
          return startResponse()
        }
        return stateResponse(null)
      }
      return { ok: true }
    }
    await state.run(days, 10)
    assert.equal(totalDuringStart, 2)
  })

  it("exposes progress: total days and a themed label per day", async () => {
    const labels: string[] = []
    const state = useGenerateFullItinerary("t1")
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") return startResponse()
        return stateResponse(null)
      }
      labels.push(state.currentDayLabel.value)
      return { ok: true }
    }
    await state.run(days, 10)
    assert.equal(state.totalDays.value, 2)
    assert.deepEqual(labels, ["Day 1 — Easy arrival", "Day 3 — Temples and tea"])
  })

  it("surfaces a 429 from the run start without looping over days", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") throw httpError(429)
        return stateResponse(null)
      }
      return { ok: true }
    }
    const { run, errorMessage, running } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), false)
    assert.equal(dayCalls().length, 0)
    assert.match(errorMessage.value, /out of AI prompts/)
    assert.equal(running.value, false)
  })
})

// ── Resume ───────────────────────────────────────────────────────────

describe("useGenerateFullItinerary resuming an interrupted run", () => {
  const interrupted = {
    runId: "run-1",
    mode: "outline" as const,
    outline,
    days: [
      { dayId: "d1", dayNumber: 1, status: "succeeded", attempts: 1, lastError: null },
      { dayId: "d3", dayNumber: 3, status: "failed", attempts: 1, lastError: "502" },
    ],
    remaining: [{ dayId: "d3", dayNumber: 3 }],
    summary: { total: 2, generated: 1, failed: 1, remaining: 1, creditsCharged: 2 },
  }

  it("quotes the resume price, not the start-over price", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") {
          return startResponse({ ...interrupted, resumed: true, aiUsage: aiUsage(8) })
        }
        return stateResponse(interrupted, 8)
      }
      return { ok: true }
    }
    const { run } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 8), true)

    assert.equal(confirms.length, 1)
    assert.equal(confirms[0]?.title, "Resume generating itinerary")
    assert.match(confirms[0]!.message, /already paid for/)
    assert.match(confirms[0]!.message, /Uses 1 AI prompt \(1 per day\)/)
    assert.doesNotMatch(confirms[0]!.message, /2 AI prompts/)
  })

  it("regenerates only the day the server still lists, never the finished one", async () => {
    // The ledger moves as the real one would: each day generated costs a credit,
    // so the final free refresh reports the true remaining balance rather than
    // the value captured when the run started.
    let creditsLeft = 8
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") {
          return startResponse({ ...interrupted, resumed: true, aiUsage: aiUsage(creditsLeft) })
        }
        return stateResponse(interrupted, creditsLeft)
      }
      creditsLeft -= 1
      return { ok: true }
    }
    const { run, creditsSpent, creditsRemaining } = useGenerateFullItinerary("t1")
    await run(days, 8)

    assert.deepEqual(
      dayCalls().map((c) => c.url),
      ["/api/trips/t1/days/d3/ai"],
      "day 1 already succeeded and must never be regenerated",
    )
    assert.match(String(dayCalls()[0]?.body.prompt), /Temples and tea/)
    // 2 already on the run's tally + the one day this resume generated.
    assert.equal(creditsSpent.value, 3)
    assert.equal(creditsRemaining.value, 7)
  })

  it("reports a resumable run to the caller without spending anything", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url) && opts.method !== "POST") return stateResponse(interrupted, 8)
      return { ok: true }
    }
    const { loadRunState, resumableDays, creditsRemaining } = useGenerateFullItinerary("t1")
    await loadRunState()
    assert.equal(resumableDays.value, 1)
    assert.equal(creditsRemaining.value, 8)
    assert.equal(calls.filter((c) => c.method !== "GET").length, 0)
  })

  it("treats a run with nothing left as not resumable and prices a fresh start", async () => {
    const spent = { ...interrupted, remaining: [] }
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") return startResponse()
        return stateResponse(spent, 10)
      }
      return { ok: true }
    }
    const { run, resumableDays } = useGenerateFullItinerary("t1")
    await run(days, 10)
    assert.equal(resumableDays.value, 0)
    assert.equal(confirms[0]?.title, "Generate full itinerary")
    assert.match(confirms[0]!.message, /Uses 3 AI prompts/)
  })

  it("discardRun frees the run and clears the resumable state", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "DELETE") return { cancelled: true, runId: "run-1" }
        return stateResponse(interrupted, 8)
      }
      return { ok: true }
    }
    const { loadRunState, discardRun, resumableDays } = useGenerateFullItinerary("t1")
    await loadRunState()
    assert.equal(resumableDays.value, 1)
    await discardRun()
    assert.equal(resumableDays.value, 0)
    assert.equal(calls.at(-1)?.method, "DELETE")
  })

  it("still generates when the free run peek fails", async () => {
    fetchImpl = async (url, opts) => {
      if (isRunUrl(url)) {
        if (opts.method === "POST") return startResponse()
        throw httpError(500)
      }
      return { ok: true }
    }
    const { run, resumableDays } = useGenerateFullItinerary("t1")
    assert.equal(await run(days, 10), true)
    assert.equal(resumableDays.value, 0)
    assert.equal(dayCalls().length, 2)
  })
})
