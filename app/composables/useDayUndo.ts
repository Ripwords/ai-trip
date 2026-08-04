export interface ActivitySnapshot {
  name: string
  placeId: string | null
  type: string
  description: string | null
  lat: number | null
  lng: number | null
  address: string | null
  rating: string | null
  priceLevel: number | null
  openingHours: string[] | null
  photos: string[] | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  costEstimate: string | null
  tags: string[] | null
  sortOrder: number
  notes: string | null
  actualCost: string | null
}

/** The day's accommodation fields, restored alongside activities. */
export interface AccommodationSnapshot {
  accommodationName: string | null
  accommodationPlaceId: string | null
  accommodationAddress: string | null
  accommodationLat: number | null
  accommodationLng: number | null
}

type ActivityLike = Record<string, unknown>
type DayLike = Record<string, unknown>

/** Project a loaded day row onto the restore endpoint's accommodation schema. */
export function buildAccommodationSnapshot(
  day: DayLike | null | undefined,
): AccommodationSnapshot | undefined {
  if (!day) return undefined
  return {
    accommodationName: (day.accommodationName as string | null) ?? null,
    accommodationPlaceId: (day.accommodationPlaceId as string | null) ?? null,
    accommodationAddress: (day.accommodationAddress as string | null) ?? null,
    accommodationLat: (day.accommodationLat as number | null) ?? null,
    accommodationLng: (day.accommodationLng as number | null) ?? null,
  }
}

/** Project loaded activity rows onto exactly the restore endpoint's schema. */
export function buildDaySnapshot(activities: ActivityLike[]): ActivitySnapshot[] {
  return activities.map((a) => ({
    name: String(a.name ?? ""),
    placeId: (a.placeId as string | null) ?? null,
    type: String(a.type ?? "attraction"),
    description: (a.description as string | null) ?? null,
    lat: (a.lat as number | null) ?? null,
    lng: (a.lng as number | null) ?? null,
    address: (a.address as string | null) ?? null,
    rating: (a.rating as string | null) ?? null,
    priceLevel: (a.priceLevel as number | null) ?? null,
    openingHours: (a.openingHours as string[] | null) ?? null,
    photos: (a.photos as string[] | null) ?? null,
    suggestedTime: (a.suggestedTime as string | null) ?? null,
    estimatedDurationMinutes: (a.estimatedDurationMinutes as number | null) ?? null,
    costEstimate: (a.costEstimate as string | null) ?? null,
    tags: (a.tags as string[] | null) ?? null,
    sortOrder: Number(a.sortOrder ?? 0),
    notes: (a.notes as string | null) ?? null,
    actualCost: (a.actualCost as string | null) ?? null,
  }))
}

interface DaySnapshot {
  activities: ActivitySnapshot[]
  accommodation?: AccommodationSnapshot
}

/** Per-day snapshot store + restore call. Snapshots live only in memory. */
export function useDayUndo(tripId: string) {
  const snapshots = new Map<string, DaySnapshot>()

  /**
   * `day` is optional only so existing call sites that have no day row keep
   * compiling; pass it wherever the change could touch accommodation, or Undo
   * will report success while leaving it in place.
   */
  function snapshot(dayId: string, activities: ActivityLike[], day?: DayLike | null) {
    snapshots.set(dayId, {
      activities: buildDaySnapshot(activities),
      accommodation: buildAccommodationSnapshot(day),
    })
  }

  async function restore(dayId: string): Promise<boolean> {
    const snap = snapshots.get(dayId)
    if (!snap) return false
    await $fetch(`/api/trips/${tripId}/days/${dayId}/restore`, {
      method: "POST",
      body: { activities: snap.activities, accommodation: snap.accommodation },
    })
    snapshots.delete(dayId)
    return true
  }

  return { snapshot, restore }
}
