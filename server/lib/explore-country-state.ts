import { countryByAlpha2 } from "../../app/data/countries"

export interface ManualVisitedCountryRow {
  countryCode: string
  countryName: string
  visitType: string
  visitedAt?: string | null
  createdAt?: Date | string | null
}

export interface ExploreTripRow {
  id: string
  countryCode: string | null
  destination: string
  startDate: string
  endDate: string
  status: string
  exploreSuppressedAt?: Date | string | null
}

export interface EffectiveVisitedCountry {
  countryCode: string
  countryName: string
  visitType: "visited" | "layover" | "want_to_visit"
  visitedAt?: string | null
  createdAt?: Date | string | null
  source?: "manual" | "trip"
}

export function buildEffectiveVisitedCountries(input: {
  manualRows: ManualVisitedCountryRow[]
  trips: ExploreTripRow[]
  today?: Date
}): EffectiveVisitedCountry[] {
  const today = input.today ?? new Date()
  const byCountry = new Map<string, EffectiveVisitedCountry>()

  for (const row of input.manualRows) {
    const code = normalizeCountryCode(row.countryCode)
    if (!code) continue
    const visitType = normalizeVisitType(row.visitType)
    if (!visitType) continue
    byCountry.set(code, {
      countryCode: code,
      countryName: row.countryName,
      visitType,
      visitedAt: row.visitedAt ?? null,
      createdAt: row.createdAt ?? null,
      source: "manual",
    })
  }

  for (const trip of input.trips) {
    const code = normalizeCountryCode(trip.countryCode)
    if (!code) continue

    const existing = byCountry.get(code)
    if (existing?.visitType === "visited") continue
    if (trip.exploreSuppressedAt) continue

    const status = resolveTripStatus(trip, today)
    if (status === "completed") {
      byCountry.set(code, {
        countryCode: code,
        countryName: countryByAlpha2.get(code)?.name ?? trip.destination,
        visitType: "visited",
        visitedAt: trip.endDate,
        source: "trip",
      })
      continue
    }

    if (existing) continue

    byCountry.set(code, {
      countryCode: code,
      countryName: countryByAlpha2.get(code)?.name ?? trip.destination,
      visitType: "want_to_visit",
      visitedAt: null,
      source: "trip",
    })
  }

  return Array.from(byCountry.values())
}

function resolveTripStatus(
  trip: ExploreTripRow,
  today: Date,
): "upcoming" | "ongoing" | "completed" | "cancelled" {
  if (trip.status === "cancelled") return "cancelled"

  const todayKey = dateKey(today)
  if (trip.endDate < todayKey) return "completed"
  if (trip.startDate > todayKey) return "upcoming"
  return "ongoing"
}

function normalizeVisitType(value: string): EffectiveVisitedCountry["visitType"] | null {
  if (value === "visited" || value === "layover" || value === "want_to_visit") return value
  return null
}

function normalizeCountryCode(value: string | null): string | null {
  if (!value) return null
  const code = value.toUpperCase()
  return code.length === 2 ? code : null
}

function dateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}
