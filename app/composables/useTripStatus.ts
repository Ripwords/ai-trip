export type TripStatus = "upcoming" | "ongoing" | "completed" | "cancelled"

export interface TripStatusInfo {
  label: string
  status: TripStatus
  badgeClass: string
  textClass: string
}

export function getTripStatus(
  startDate: string,
  endDate: string,
  storedStatus?: string | null,
  options: { today?: Date } = {},
): TripStatusInfo {
  if (storedStatus === "cancelled") {
    return {
      label: "Cancelled",
      status: "cancelled",
      badgeClass: "bg-red-50 text-red-600",
      textClass: "text-red-600",
    }
  }

  const today = new Date((options.today ?? new Date()).getTime())
  today.setHours(0, 0, 0, 0)

  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T00:00:00")

  if (today < start) {
    return {
      label: "Upcoming",
      status: "upcoming",
      badgeClass: "bg-ocean-50 text-ocean-700",
      textClass: "text-ocean-700",
    }
  }
  if (today > end) {
    return {
      label: "Completed",
      status: "completed",
      badgeClass: "bg-sand-200 text-sand-600",
      textClass: "text-sand-600",
    }
  }
  return {
    label: "Ongoing",
    status: "ongoing",
    badgeClass: "bg-forest-50 text-forest-700",
    textClass: "text-forest-700",
  }
}
