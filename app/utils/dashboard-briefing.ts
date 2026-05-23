import { countryByAlpha2 } from "../data/countries"
import { iataToCountry } from "./iata-to-country"

const DAY_MS = 24 * 60 * 60 * 1000
const PRE_TRIP_WINDOW_DAYS = 7

export interface DashboardTrip {
  id: string
  destination: string
  startDate: string
  endDate: string
  days?: { accommodationName?: string | null }[]
}

export interface DashboardFlight {
  id: string
  tripId?: string | null
  flightNumber: string
  flightDate: string
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
  terminal?: string | null
  gate?: string | null
  status?: string | null
}

export interface DashboardPassport {
  countryCode: string
  expiryDate: string | null
  isDefault?: boolean
}

export interface DashboardVisaInfo {
  visaStatus: string
  maxStayDays: number | null
}

export type BriefingTone = "good" | "info" | "warn"

export interface BriefingSignal {
  key: string
  title: string
  detail: string
  tone: BriefingTone
  icon: string
  to?: string
}

export interface BriefingChip {
  label: string
  tone?: BriefingTone
}

export interface PreTripBriefing {
  tripId: string
  destination: string
  daysUntil: number
  departureDate: string
  startDate: string
  endDate: string
  summary: string
  chips: BriefingChip[]
  signals: BriefingSignal[]
}

export function daysUntilDate(date: string, today = new Date()): number {
  const target = parseDateOnly(date)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((target.getTime() - startOfToday.getTime()) / DAY_MS)
}

export function getPreTripCandidate<T extends DashboardTrip>(
  trips: T[] | null | undefined,
  today = new Date(),
  flights: DashboardFlight[] | null | undefined = [],
): T | null {
  if (!trips?.length) return null

  return (
    trips
      .filter((trip) => {
        const daysUntil = daysUntilDate(effectiveTravelDate(trip, flights), today)
        return daysUntil >= 0 && daysUntil <= PRE_TRIP_WINDOW_DAYS
      })
      .toSorted((a, b) =>
        effectiveTravelDate(a, flights).localeCompare(effectiveTravelDate(b, flights)),
      )[0] ?? null
  )
}

export function buildPreTripBriefing(input: {
  trip: DashboardTrip | null | undefined
  flights?: DashboardFlight[] | null
  passports?: DashboardPassport[] | null
  visaByCountry?: Record<string, DashboardVisaInfo> | null
  today?: Date
}): PreTripBriefing | null {
  const { trip, flights = [], passports = [], visaByCountry = null, today = new Date() } = input
  if (!trip) return null

  const tripFlights = flights
    ?.filter((flight) => flight.tripId === trip.id)
    .toSorted(compareFlights)
  const outboundFlights = buildOutboundFlightChain(tripFlights || [])
  const departureDate = effectiveTravelDate(trip, tripFlights)
  const daysUntil = daysUntilDate(departureDate, today)
  if (daysUntil < 0 || daysUntil > PRE_TRIP_WINDOW_DAYS) return null

  const nextFlight =
    outboundFlights.find((flight) => flight.flightDate >= dateKey(today)) ?? outboundFlights[0]
  const defaultPassport =
    passports?.find((passport) => passport.isDefault) ?? passports?.[0] ?? null
  const itineraryCountries = deriveArrivalCountries(outboundFlights)
  const finalCountry = itineraryCountries.at(-1) ?? null
  const layoverCountries = unique(
    itineraryCountries.slice(0, -1).filter((country) => country !== finalCountry),
  )
  const hasAccommodation = !!trip.days?.some((day) => day.accommodationName)

  const signals = compact<BriefingSignal>([
    buildVisaSignal({ defaultPassport, finalCountry, layoverCountries, visaByCountry }),
    defaultPassport ? buildPassportSignal(defaultPassport, trip.endDate) : null,
    buildFlightSignal(nextFlight),
    buildStaySignal(hasAccommodation),
  ]).slice(0, 3)

  const chips = compact<BriefingChip>([
    nextFlight ? { label: flightRoute(nextFlight) } : null,
    nextFlight?.terminal ? { label: `Terminal ${nextFlight.terminal}` } : null,
    hasAccommodation ? { label: "Stay saved" } : null,
    layoverCountries.length > 0
      ? { label: `Layover: ${layoverCountries.join(", ")}`, tone: "warn" }
      : null,
  ]).slice(0, 4)

  return {
    tripId: trip.id,
    destination: trip.destination,
    daysUntil,
    departureDate,
    startDate: trip.startDate,
    endDate: trip.endDate,
    summary: buildSummary({ trip, nextFlight, signals, daysUntil }),
    chips,
    signals,
  }
}

function buildVisaSignal(input: {
  defaultPassport: DashboardPassport | null
  finalCountry: string | null
  layoverCountries: string[]
  visaByCountry: Record<string, DashboardVisaInfo> | null
}): BriefingSignal {
  const { defaultPassport, finalCountry, layoverCountries, visaByCountry } = input
  if (!defaultPassport) {
    return {
      key: "passport-missing",
      title: "Add passport",
      detail: "Needed for visa checks before departure.",
      tone: "warn",
      icon: "material-symbols:passport",
      to: "/settings",
    }
  }
  if (!finalCountry && layoverCountries.length === 0) {
    return {
      key: "visa-missing-route",
      title: "Visa not checked",
      detail: "Link flight details to infer destination and layovers.",
      tone: "info",
      icon: "lucide:shield-question",
      to: "/flights",
    }
  }

  const destinationIssue = finalCountry
    ? visaNeedsReview(visaByCountry?.[finalCountry]?.visaStatus)
    : false
  const layoverIssues = layoverCountries.filter((country) =>
    visaNeedsReview(visaByCountry?.[country]?.visaStatus),
  )

  if (destinationIssue && finalCountry) {
    return {
      key: "visa-destination",
      title: "Visa review needed",
      detail: `Check ${countryName(finalCountry)} requirements before departure.`,
      tone: "warn",
      icon: "lucide:shield-alert",
      to: "/flights",
    }
  }

  if (layoverIssues.length > 0) {
    return {
      key: "visa-layover",
      title: "Layover visa check",
      detail: `${layoverIssues.map(countryName).join(", ")} if leaving the airport.`,
      tone: "warn",
      icon: "lucide:shield-alert",
      to: "/flights",
    }
  }

  return {
    key: "visa-clear",
    title: "Visa looks clear",
    detail: finalCountry
      ? `${countryName(finalCountry)} checked for your passport.`
      : "No visa issue found.",
    tone: "good",
    icon: "lucide:shield-check",
    to: "/flights",
  }
}

function buildPassportSignal(passport: DashboardPassport, tripEndDate: string): BriefingSignal {
  if (!passport.expiryDate) {
    return {
      key: "passport-expiry-missing",
      title: "Passport expiry missing",
      detail: "Add the expiry date for better readiness checks.",
      tone: "warn",
      icon: "material-symbols:passport",
      to: "/settings",
    }
  }

  const expiry = parseDateOnly(passport.expiryDate)
  const tripEnd = parseDateOnly(tripEndDate)
  const sixMonthsAfterTrip = new Date(tripEnd)
  sixMonthsAfterTrip.setMonth(sixMonthsAfterTrip.getMonth() + 6)

  if (expiry <= tripEnd) {
    return {
      key: "passport-expired",
      title: "Passport expires soon",
      detail: "Expiry falls before this trip ends.",
      tone: "warn",
      icon: "material-symbols:passport",
      to: "/settings",
    }
  }

  if (expiry < sixMonthsAfterTrip) {
    return {
      key: "passport-six-months",
      title: "Passport validity check",
      detail: "Some destinations expect 6 months validity after travel.",
      tone: "warn",
      icon: "material-symbols:passport",
      to: "/settings",
    }
  }

  return {
    key: "passport-ready",
    title: "Passport ready",
    detail: "Default passport remains valid after the trip.",
    tone: "good",
    icon: "material-symbols:passport",
    to: "/settings",
  }
}

function buildFlightSignal(flight: DashboardFlight | undefined): BriefingSignal {
  if (!flight) {
    return {
      key: "flight-missing",
      title: "Add flight details",
      detail: "Link a flight for departure and layover readiness.",
      tone: "info",
      icon: "lucide:plane",
      to: "/flights",
    }
  }

  return {
    key: "flight-saved",
    title: "Flight saved",
    detail: `${flight.flightNumber} ${flightRoute(flight)}${formatFlightTime(flight.departureTime)}`,
    tone: "info",
    icon: "lucide:plane",
    to: "/flights",
  }
}

function buildStaySignal(hasAccommodation: boolean): BriefingSignal {
  return hasAccommodation
    ? {
        key: "stay-saved",
        title: "Stay saved",
        detail: "Accommodation is set on the itinerary.",
        tone: "info",
        icon: "lucide:bed",
      }
    : {
        key: "stay-missing",
        title: "Add stay details",
        detail: "Save accommodation so arrival day is easier.",
        tone: "info",
        icon: "lucide:bed",
      }
}

function buildSummary(input: {
  trip: DashboardTrip
  nextFlight: DashboardFlight | undefined
  signals: BriefingSignal[]
  daysUntil: number
}): string {
  const { trip, nextFlight, signals, daysUntil } = input
  const issue = signals.find((signal) => signal.tone === "warn")
  const lead = nextFlight
    ? `${nextFlight.flightNumber} leaves ${nextFlight.departureAirport ?? "your departure airport"}${formatFlightTime(nextFlight.departureTime)}.`
    : `${trip.destination} starts in ${daysUntil} ${daysUntil === 1 ? "day" : "days"}.`
  return issue
    ? `${lead} ${issue.title}: ${issue.detail}`
    : `${lead} Key travel details look ready.`
}

function deriveArrivalCountries(flights: DashboardFlight[]): string[] {
  return unique(
    flights
      .map((flight) => (flight.arrivalAirport ? iataToCountry[flight.arrivalAirport] : null))
      .filter((country): country is string => !!country),
  )
}

function buildOutboundFlightChain(flights: DashboardFlight[]): DashboardFlight[] {
  const [first, ...rest] = flights
  if (!first) return []

  const chain = [first]
  let current = first
  for (const flight of rest) {
    if (
      current.arrivalAirport &&
      flight.departureAirport &&
      current.arrivalAirport !== flight.departureAirport
    ) {
      break
    }
    if (!isLikelyConnection(current, flight)) break

    chain.push(flight)
    current = flight
  }
  return chain
}

function isLikelyConnection(previous: DashboardFlight, next: DashboardFlight): boolean {
  if (previous.arrivalTime && next.departureTime) {
    const gap = new Date(next.departureTime).getTime() - new Date(previous.arrivalTime).getTime()
    return gap >= 0 && gap <= 36 * 60 * 60 * 1000
  }

  const dayGap =
    (parseDateOnly(next.flightDate).getTime() - parseDateOnly(previous.flightDate).getTime()) /
    DAY_MS
  return dayGap >= 0 && dayGap <= 1
}

function effectiveTravelDate(
  trip: DashboardTrip,
  flights: DashboardFlight[] | null | undefined,
): string {
  const firstFlight = flights
    ?.filter((flight) => flight.tripId === trip.id)
    .toSorted(compareFlights)[0]
  if (firstFlight && firstFlight.flightDate < trip.startDate) return firstFlight.flightDate
  return trip.startDate
}

function compareFlights(a: DashboardFlight, b: DashboardFlight): number {
  const dateCompare = a.flightDate.localeCompare(b.flightDate)
  if (dateCompare !== 0) return dateCompare
  return (a.departureTime ?? "").localeCompare(b.departureTime ?? "")
}

function flightRoute(flight: DashboardFlight): string {
  return `${flight.departureAirport ?? "???"} -> ${flight.arrivalAirport ?? "???"}`
}

function formatFlightTime(value: string | null): string {
  if (!value) return ""
  return ` at ${new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))}`
}

function visaNeedsReview(status: string | undefined): boolean {
  return !status || status === "unknown" || status === "visa-required" || status === "evisa"
}

function countryName(code: string): string {
  return countryByAlpha2.get(code)?.name ?? code
}

function dateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year!, month! - 1, day)
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

function compact<T>(items: (T | null | undefined)[]): T[] {
  return items.filter((item): item is T => item != null)
}
