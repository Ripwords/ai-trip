/** What the trip row stores: the only lifecycle fact a user can set. */
export type TripLifecycle = "active" | "cancelled"

/** What a reader sees. Derived from the dates unless the trip was cancelled. */
export type TripStatus = "upcoming" | "ongoing" | "completed" | "cancelled"

export const TRIP_LIFECYCLES = ["active", "cancelled"] as const

export function toDateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

export function deriveTripStatus(
  trip: {
    startDate: string
    endDate: string
    /**
     * `string`, not `TripLifecycle`: un-backfilled rows still carry `"draft"`,
     * `"upcoming"` or `"completed"`, and every one of those must fall through
     * to the date branches rather than be trusted.
     */
    status: string
  },
  today: Date = new Date(),
): TripStatus {
  if (trip.status === "cancelled") return "cancelled"

  const todayKey = toDateKey(today)
  if (trip.endDate < todayKey) return "completed"
  if (trip.startDate > todayKey) return "upcoming"
  return "ongoing"
}
