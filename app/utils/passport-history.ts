import { airportCoordinates } from "./airport-coordinates"
import { iataToCountry } from "./iata-to-country"
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

export type CountrySource = "visited" | "layover" | "flight"

export interface PassportCountryEntry {
  code: string
  name: string
  flag: string
  source: CountrySource
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
  const year = input.year ?? null

  const flights = year == null ? allFlights : allFlights.filter((f) => yearOf(f.flightDate) === year)

  const uniqueAirports = unique(
    flights.flatMap((f) => [f.departureAirport, f.arrivalAirport].filter(nonEmpty)),
  )
  const uniqueAirlines = unique(flights.map((f) => f.airline).filter(nonEmpty))

  return {
    totalFlights: flights.length,
    totalDistanceKm: 0,
    uniqueAirports,
    uniqueAirlines,
    countries: [],
    countryFlags: [],
    recentFlights: [],
    routeSegments: [],
    availableYears: collectYears(allFlights),
  }
}

function yearOf(date: string): number {
  const [y] = date.split("-")
  return Number(y)
}

function collectYears(flights: PassportFlight[]): number[] {
  return unique(flights.map((f) => yearOf(f.flightDate)).filter((y) => Number.isFinite(y))).toSorted(
    (a, b) => b - a,
  )
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0
}
