import { eq } from "drizzle-orm"
import type { db } from "../db"
import { itineraryDays } from "../db/schema"

/** Drizzle transaction handle, structurally (also satisfied by `db` itself). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The `itinerary_days` columns the stay grouping reads. */
export interface DayAccommodation {
  id: string
  /** Calendar date, `YYYY-MM-DD`. */
  date: string
  accommodationName: string | null
  accommodationPlaceId: string | null
  accommodationAddress: string | null
  accommodationLat: number | null
  accommodationLng: number | null
}

/** One contiguous run of nights at the same place — a stay-to-be. */
export interface StayRun {
  /** Place id when Google verified it, else the lowercased name. */
  key: string
  name: string
  placeId: string | null
  address: string | null
  lat: number | null
  lng: number | null
  /** First night, `YYYY-MM-DD`. */
  checkIn: string
  /** Exclusive — the morning after the last night. */
  checkOut: string
  dayIds: string[]
}

/** The stay fields mirrored onto the day read-cache. */
export interface StayMirror {
  id: string
  name: string
  placeId: string | null
  address: string | null
  lat: number | null
  lng: number | null
}

/**
 * Shift a `YYYY-MM-DD` calendar date by whole days. Deliberately hand-rolled
 * via `Date.UTC`: a bare date string parsed as a local instant drifts a day
 * for anyone west of UTC, which is exactly how check-out dates go wrong.
 */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number)
  const shifted = new Date(Date.UTC(y!, m! - 1, d! + days))
  return shifted.toISOString().slice(0, 10)
}

/**
 * The identity a day's accommodation groups on: the Google place id when we
 * have one, else the lowercased name so a casing edit doesn't split a run.
 * `null` when the day has no accommodation at all.
 */
export function stayKey(day: DayAccommodation): string | null {
  if (day.accommodationPlaceId) return day.accommodationPlaceId
  const name = day.accommodationName?.trim()
  if (!name) return null
  return name.toLowerCase()
}

/**
 * Collapse day rows into contiguous stay runs. A hotel revisited later in the
 * trip is two stays, not one — the run breaks on a date gap or on any day in
 * between with different (or no) accommodation.
 */
export function groupDaysIntoStayRuns(days: readonly DayAccommodation[]): StayRun[] {
  const sorted = [...days].toSorted((a, b) => a.date.localeCompare(b.date))

  const runs: StayRun[] = []
  let current: StayRun | null = null
  let lastDate: string | null = null

  for (const day of sorted) {
    const key = stayKey(day)
    const contiguous = lastDate !== null && day.date === addCalendarDays(lastDate, 1)
    lastDate = day.date

    if (!key || !day.accommodationName) {
      current = null
      continue
    }

    if (current && current.key === key && contiguous) {
      current.dayIds.push(day.id)
      current.checkOut = addCalendarDays(day.date, 1)
      continue
    }

    current = {
      key,
      name: day.accommodationName,
      placeId: day.accommodationPlaceId,
      address: day.accommodationAddress,
      lat: day.accommodationLat,
      lng: day.accommodationLng,
      checkIn: day.date,
      checkOut: addCalendarDays(day.date, 1),
      dayIds: [day.id],
    }
    runs.push(current)
  }

  return runs
}

/**
 * The single writer for `itinerary_days.accommodation_*`. Those columns are a
 * derived read-cache of the stay; any other write to them is a drift bug.
 */
export async function syncDayAccommodation(tx: Tx, stay: StayMirror): Promise<void> {
  await tx
    .update(itineraryDays)
    .set({
      accommodationName: stay.name,
      accommodationPlaceId: stay.placeId,
      accommodationAddress: stay.address,
      accommodationLat: stay.lat,
      accommodationLng: stay.lng,
    })
    .where(eq(itineraryDays.stayId, stay.id))
}
