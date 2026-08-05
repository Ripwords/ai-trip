import { ref } from "vue"
import type {
  GenerationRunStartResponse,
  GenerationRunStateResponse,
} from "#shared/utils/generation-run-contract"
import { planGenerationRun } from "../utils/generation-plan"
import { buildDayPromptFromOutline, type OutlineDayEntry } from "../utils/outline-prompt"

type DayWithActivities = {
  id: string
  dayNumber: number
  activities: { id: string }[]
}

const GENERIC_PROMPT = "Plan this day with a good mix of activities, food, and sightseeing"
const OUTLINE_FALLBACK_NOTICE =
  "Couldn't plan the trip as a whole — filling each day without trip-level planning."

function statusOf(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "statusCode" in e) {
    const code = (e as { statusCode?: unknown }).statusCode
    if (typeof code === "number") return code
  }
  return undefined
}

export function useGenerateFullItinerary(tripId: string) {
  const { confirm } = useConfirm()

  const running = ref(false)
  const currentDayIndex = ref(0)
  const totalDays = ref(0)
  const currentDayLabel = ref("")
  const errorMessage = ref("")
  const noticeMessage = ref("")
  /** Credits this run has billed so far, updated as the loop advances. */
  const creditsSpent = ref(0)
  /** Credits left this month, decremented alongside `creditsSpent`. */
  const creditsRemaining = ref<number | undefined>(undefined)
  /** Days a previous, interrupted run still has left. Zero when there is none. */
  const resumableDays = ref(0)

  async function generateDay(dayId: string, prompt: string, runId: string): Promise<void> {
    await $fetch(`/api/trips/${tripId}/days/${dayId}/ai`, {
      method: "POST",
      body: { prompt, intent: "fill_gaps", runId },
    })
  }

  /**
   * Free look at the trip's live run. Called before the confirm dialog so the
   * traveler is quoted the price of RESUMING (N) rather than of starting over
   * (N+1) — and on page load, so a reopened tab can offer to pick up.
   */
  async function loadRunState(): Promise<GenerationRunStateResponse | null> {
    try {
      const state = await $fetch<GenerationRunStateResponse>(`/api/trips/${tripId}/generation-run`)
      resumableDays.value = state.run?.remaining.length ?? 0
      creditsRemaining.value = state.aiUsage.remaining
      return state
    } catch {
      // A run peek must never block generation; fall back to starting fresh.
      resumableDays.value = 0
      return null
    }
  }

  /** Abandon the live run so the next generate starts from a fresh plan. */
  async function discardRun(): Promise<void> {
    try {
      await $fetch(`/api/trips/${tripId}/generation-run`, { method: "DELETE" })
    } finally {
      resumableDays.value = 0
    }
  }

  async function run(days: DayWithActivities[], aiRemaining?: number): Promise<boolean> {
    const emptyDayCount = days.filter((d) => d.activities.length === 0).length

    // Costs nothing, so it happens before the confirm: resuming reuses a plan
    // that has already been paid for, and quoting N+1 for it would be a lie.
    const state = await loadRunState()
    const resumable = state?.run && state.run.remaining.length > 0 ? state.run : null
    const dayCount = resumable ? resumable.remaining.length : emptyDayCount
    const remainingCredits = state?.aiUsage.remaining ?? aiRemaining

    const plan = planGenerationRun(dayCount, remainingCredits, {
      outlineAlreadyPaid: Boolean(resumable),
    })
    if (plan.mode === "none") return false
    if (!(await confirm(plan.confirm))) return false

    running.value = true
    errorMessage.value = ""
    noticeMessage.value = ""
    currentDayIndex.value = 0
    currentDayLabel.value = ""
    // Set from the plan up front so progress UI never renders "Day 1 of 0"
    // while the run request (which can take several seconds while the outline
    // is generated) is in flight.
    totalDays.value = plan.dayCount

    try {
      // One call starts a run or picks up the trip's existing one. The server
      // decides which, and charges the outline credit at most once per run.
      let started: GenerationRunStartResponse
      try {
        started = await $fetch<GenerationRunStartResponse>(`/api/trips/${tripId}/generation-run`, {
          method: "POST",
          // `generic` means the traveler can't afford the plan on top of the
          // days, so don't buy one.
          body: { skipOutline: plan.mode === "generic" },
        })
      } catch (e) {
        errorMessage.value =
          statusOf(e) === 429
            ? "You're out of AI prompts this month."
            : "Couldn't start generation. Please try again."
        return false
      }

      creditsSpent.value = started.summary.creditsCharged
      creditsRemaining.value = started.aiUsage.remaining
      if (plan.mode === "outline" && !started.outline) {
        noticeMessage.value = OUTLINE_FALLBACK_NOTICE
      }

      const outlineByDayId = new Map<string, OutlineDayEntry>(
        (started.outline?.days ?? []).map((d) => [d.dayId, d]),
      )
      const avoidRepeats = started.outline?.avoidRepeats ?? []

      // Sequential and in day order on purpose — NOT merely to be gentle on
      // quota. Each day persists before the next starts, and the day AI's
      // cross-day dedup reads what came before; generating in parallel would
      // let two days pick the same restaurant. The server returns `remaining`
      // already sorted by day number.
      const targets = started.remaining.slice(0, plan.dayCount)
      totalDays.value = targets.length
      const failed: number[] = []

      for (let i = 0; i < targets.length; i++) {
        const day = targets[i]!
        const entry = outlineByDayId.get(day.dayId)
        currentDayIndex.value = i
        currentDayLabel.value = entry
          ? `Day ${day.dayNumber} — ${entry.theme}`
          : `Day ${day.dayNumber}`

        const prompt = entry ? buildDayPromptFromOutline(entry, avoidRepeats) : GENERIC_PROMPT
        try {
          await generateDay(day.dayId, prompt, started.runId)
          creditsSpent.value += 1
          if (creditsRemaining.value !== undefined) creditsRemaining.value -= 1
        } catch (e) {
          const status = statusOf(e)
          // 409: another tab holds this day. Not a failure of ours — leaving it
          // out of `failed` keeps it available to the next resume.
          if (status === 409) continue
          // A 400 means the outline-derived prompt tripped the server's prompt
          // sanitizer — retry the day once with the plain prompt. The day's
          // claim was already released as failed, so the retry re-claims it.
          if (status === 400 && prompt !== GENERIC_PROMPT) {
            try {
              await generateDay(day.dayId, GENERIC_PROMPT, started.runId)
              creditsSpent.value += 1
              if (creditsRemaining.value !== undefined) creditsRemaining.value -= 1
              continue
            } catch {
              failed.push(day.dayNumber)
              continue
            }
          }
          failed.push(day.dayNumber)
        }
      }

      if (failed.length > 0) {
        const dayList = failed.join(", ")
        errorMessage.value = `Generated ${targets.length - failed.length} of ${targets.length} days. Day ${dayList} failed — press Generate again to retry just those days; you won't be charged for the days that worked.`
      }

      currentDayLabel.value = ""
      await loadRunState()
      return true
    } finally {
      running.value = false
    }
  }

  return {
    run,
    loadRunState,
    discardRun,
    running,
    currentDayIndex,
    totalDays,
    currentDayLabel,
    errorMessage,
    noticeMessage,
    creditsSpent,
    creditsRemaining,
    resumableDays,
  }
}
