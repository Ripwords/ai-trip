import { computed, unref, type Ref } from "vue"

interface MinimalActivity {
  id: string
  name: string
  type: string
}

interface MinimalDay {
  id: string
  dayNumber: number
  accommodationName: string | null
  activities: MinimalActivity[]
}

interface MinimalTrip {
  id: string
  destination: string
  days: MinimalDay[]
}

export function useDiscussionStarters(
  trip: Ref<MinimalTrip | null>,
  activeDay: Ref<MinimalDay | null>,
) {
  return computed<string[]>(() => {
    const t = unref(trip)
    const d = unref(activeDay)
    if (!t) return []

    const starters: string[] = []

    if (d && d.activities.length >= 6) {
      starters.push(`Is Day ${d.dayNumber} too packed?`)
    }
    if (t.days.length >= 3) {
      starters.push("Should I rearrange any days?")
    }


    if (t.days.some((day) => !day.accommodationName)) {
      starters.push("Help me pick a hotel for the empty days")
    }

    if (starters.length === 0) {
      starters.push(`What's worth doing in ${t.destination} that I might be missing?`)
    }

    return starters.slice(0, 4)
  })
}
