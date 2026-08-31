import { deriveTripStatus, type TripStatus } from "#shared/utils/trip-status"

export type { TripStatus }

export interface TripStatusInfo {
  label: string
  status: TripStatus
  badgeClass: string
  textClass: string
}

const PRESENTATION: Record<TripStatus, Omit<TripStatusInfo, "status">> = {
  cancelled: {
    label: "Cancelled",
    badgeClass: "bg-red-50 text-red-600",
    textClass: "text-red-600",
  },
  upcoming: {
    label: "Upcoming",
    badgeClass: "bg-ocean-50 text-ocean-700",
    textClass: "text-ocean-700",
  },
  completed: {
    label: "Completed",
    badgeClass: "bg-sand-200 text-sand-600",
    textClass: "text-sand-600",
  },
  ongoing: {
    label: "Ongoing",
    badgeClass: "bg-forest-50 text-forest-700",
    textClass: "text-forest-700",
  },
}

export function getTripStatus(
  startDate: string,
  endDate: string,
  storedStatus?: string | null,
  options: { today?: Date } = {},
): TripStatusInfo {
  const status = deriveTripStatus({ startDate, endDate, status: storedStatus ?? "" }, options.today)
  return { status, ...PRESENTATION[status] }
}
