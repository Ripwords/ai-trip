import { ref } from "vue"

type DayWithActivities = {
  id: string
  dayNumber: number
  activities: { id: string }[]
}

export function useGenerateFullItinerary(tripId: string) {
  const { confirm } = useConfirm()

  const running = ref(false)
  const currentDayIndex = ref(0)
  const errorMessage = ref("")

  async function run(days: DayWithActivities[], aiRemaining?: number): Promise<boolean> {
    const emptyDays = days.filter((d) => d.activities.length === 0)
    if (emptyDays.length === 0) return false

    if (aiRemaining != null && aiRemaining < emptyDays.length) {
      const ok = await confirm({
        title: "Not enough AI prompts",
        message: `You need ${emptyDays.length} prompts but only have ${aiRemaining} remaining this month. Generate as many as possible?`,
        confirmText: "Continue anyway",
      })
      if (!ok) return false
    } else {
      const ok = await confirm({
        title: "Generate full itinerary",
        message: `This will use AI to fill ${emptyDays.length} empty day${emptyDays.length > 1 ? "s" : ""}. Each day costs 1 AI prompt.`,
        confirmText: "Generate",
      })
      if (!ok) return false
    }

    running.value = true
    errorMessage.value = ""

    for (let i = 0; i < emptyDays.length; i++) {
      const day = emptyDays[i]!
      currentDayIndex.value = i
      try {
        await $fetch(`/api/trips/${tripId}/days/${day.id}/ai`, {
          method: "POST",
          body: {
            prompt: "Plan this day with a good mix of activities, food, and sightseeing",
            mode: "execute",
          },
        })
      } catch {
        errorMessage.value = `Generated ${i} of ${emptyDays.length} days. Day ${day.dayNumber} failed — try again manually.`
        running.value = false
        return true
      }
    }

    running.value = false
    return true
  }

  return { run, running, currentDayIndex, errorMessage }
}
