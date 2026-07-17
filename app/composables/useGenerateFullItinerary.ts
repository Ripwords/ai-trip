import { ref } from "vue"
import { planGenerationRun } from "../utils/generation-plan"
import { buildDayPromptFromOutline, type OutlineDayEntry } from "../utils/outline-prompt"

type DayWithActivities = {
  id: string
  dayNumber: number
  activities: { id: string }[]
}

interface OutlineResponse {
  outline: {
    days: OutlineDayEntry[]
    avoidRepeats: string[]
  }
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

  async function generateDay(dayId: string, prompt: string): Promise<void> {
    await $fetch(`/api/trips/${tripId}/days/${dayId}/ai`, {
      method: "POST",
      body: { prompt, intent: "fill_gaps" },
    })
  }

  async function run(days: DayWithActivities[], aiRemaining?: number): Promise<boolean> {
    // Sorted ascending so the loop below is in day order by construction: each
    // day persists before the next starts, and the day AI's own cross-day
    // dedup depends on seeing what came before.
    const emptyDays = days
      .filter((d) => d.activities.length === 0)
      .toSorted((a, b) => a.dayNumber - b.dayNumber)
    const plan = planGenerationRun(emptyDays.length, aiRemaining)
    if (plan.mode === "none") return false

    if (!(await confirm(plan.confirm))) return false

    running.value = true
    errorMessage.value = ""
    noticeMessage.value = ""
    currentDayIndex.value = 0
    currentDayLabel.value = ""
    // Set from the plan up front so progress UI never renders "Day 1 of 0"
    // while the outline fetch (which can take several seconds) is in flight.
    totalDays.value = plan.dayCount

    try {
      // Outline is best-effort: any failure — including a 200 with zero usable
      // days — downgrades to generic prompts rather than blocking generation.
      let outlineByDayId = new Map<string, OutlineDayEntry>()
      let avoidRepeats: string[] = []
      if (plan.mode === "outline") {
        try {
          const res = await $fetch<OutlineResponse>(`/api/trips/${tripId}/generate-outline`, {
            method: "POST",
            body: {},
          })
          if (res.outline.days.length === 0) {
            noticeMessage.value = OUTLINE_FALLBACK_NOTICE
          } else {
            outlineByDayId = new Map(res.outline.days.map((d) => [d.dayId, d]))
            avoidRepeats = res.outline.avoidRepeats
          }
        } catch {
          noticeMessage.value = OUTLINE_FALLBACK_NOTICE
        }
      }

      // Sequential and in day order on purpose: each day persists before the next
      // starts, so the day AI's own cross-day dedup sees what came before.
      const targets = emptyDays.slice(0, plan.dayCount)
      totalDays.value = targets.length
      const failed: number[] = []

      for (let i = 0; i < targets.length; i++) {
        const day = targets[i]!
        const entry = outlineByDayId.get(day.id)
        currentDayIndex.value = i
        currentDayLabel.value = entry
          ? `Day ${day.dayNumber} — ${entry.theme}`
          : `Day ${day.dayNumber}`

        const prompt = entry ? buildDayPromptFromOutline(entry, avoidRepeats) : GENERIC_PROMPT
        try {
          await generateDay(day.id, prompt)
        } catch (e) {
          // A 400 means the outline-derived prompt tripped the server's prompt
          // sanitizer — retry the day once with the plain prompt.
          if (statusOf(e) === 400 && prompt !== GENERIC_PROMPT) {
            try {
              await generateDay(day.id, GENERIC_PROMPT)
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
        errorMessage.value = `Generated ${targets.length - failed.length} of ${targets.length} days. Day ${dayList} failed — try again manually.`
      }

      currentDayLabel.value = ""
      return true
    } finally {
      running.value = false
    }
  }

  return {
    run,
    running,
    currentDayIndex,
    totalDays,
    currentDayLabel,
    errorMessage,
    noticeMessage,
  }
}
