import { airportCoordinates } from "./airport-coordinates"
import { countryByAlpha2, countryFlag } from "../data/countries"

export interface PassportFlight {
  id: string
  flightNumber: string
  flightDate: string
  airline: string | null
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
  status?: string | null
}

export interface PassportVisitedCountry {
  countryCode: string
  countryName: string
  visitType: string
  visitedAt?: string | null
}

export interface PassportCountryEntry {
  code: string
  name: string
  flag: string
}

export interface PassportRouteSegment {
  flightId: string
  from: { code: string; lat: number; lng: number }
  to: { code: string; lat: number; lng: number }
}

export interface PassportRecentFlight {
  id: string
  flightNumber: string
  flightDate: string
  airline: string | null
  departureAirport: string | null
  arrivalAirport: string | null
}

export interface PassportHistory {
  totalFlights: number
  totalDistanceKm: number
  uniqueAirports: string[]
  uniqueAirlines: string[]
  countries: PassportCountryEntry[]
  countryFlags: string[]
  recentFlights: PassportRecentFlight[]
  routeSegments: PassportRouteSegment[]
  availableYears: number[]
}

export interface BuildPassportHistoryInput {
  flights: PassportFlight[] | null | undefined
  visitedCountries: PassportVisitedCountry[] | null | undefined
  year?: number | null
  recentFlightLimit?: number
}

export function buildPassportHistory(input: BuildPassportHistoryInput): PassportHistory {
  const allFlights = input.flights ?? []
  const visited = input.visitedCountries ?? []
  const year = input.year ?? null
  const recentLimit = Math.max(1, Math.min(5, input.recentFlightLimit ?? 4))

  const flights =
    year == null ? allFlights : allFlights.filter((f) => yearOf(f.flightDate) === year)

  const uniqueAirports = unique(
    flights.flatMap((f) => [f.departureAirport, f.arrivalAirport].filter(nonEmpty)),
  )
  const uniqueAirlines = unique(flights.map((f) => f.airline).filter(nonEmpty))

  const routeSegments: PassportRouteSegment[] = []
  let totalDistance = 0
  for (const f of flights) {
    const from = f.departureAirport ? airportCoordinates[f.departureAirport] : undefined
    const to = f.arrivalAirport ? airportCoordinates[f.arrivalAirport] : undefined
    if (!from || !to || !f.departureAirport || !f.arrivalAirport) continue
    totalDistance += haversineKm(from, to)
    routeSegments.push({
      flightId: f.id,
      from: { code: f.departureAirport, ...from },
      to: { code: f.arrivalAirport, ...to },
    })
  }

  const countries = buildVisitedCountries(visited)
  const countryFlags = countries.map((c) => c.flag)

  const recentFlights = flights
    .toSorted((a, b) => b.flightDate.localeCompare(a.flightDate))
    .slice(0, recentLimit)
    .map<PassportRecentFlight>((f) => ({
      id: f.id,
      flightNumber: f.flightNumber,
      flightDate: f.flightDate,
      airline: f.airline,
      departureAirport: f.departureAirport,
      arrivalAirport: f.arrivalAirport,
    }))

  return {
    totalFlights: flights.length,
    totalDistanceKm: Math.round(totalDistance),
    uniqueAirports,
    uniqueAirlines,
    countries,
    countryFlags,
    recentFlights,
    routeSegments,
    availableYears: collectYears(allFlights),
  }
}

function buildVisitedCountries(visited: PassportVisitedCountry[]): PassportCountryEntry[] {
  const map = new Map<string, PassportCountryEntry>()

  for (const v of visited) {
    if (v.visitType !== "visited") continue
    const code = v.countryCode.toUpperCase()
    map.set(code, {
      code,
      name: countryByAlpha2.get(code)?.name ?? v.countryName,
      flag: countryFlag(code),
    })
  }

  return Array.from(map.values()).toSorted((a, b) => a.name.localeCompare(b.name))
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function yearOf(date: string): number {
  const [y] = date.split("-")
  return Number(y)
}

function collectYears(flights: PassportFlight[]): number[] {
  return unique(
    flights.map((f) => yearOf(f.flightDate)).filter((y) => Number.isFinite(y)),
  ).toSorted((a, b) => b - a)
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0
}
