/**
 * Seed script for testing pagination and dashboard stats.
 *
 * Usage: npx tsx server/db/seed-test-data.ts
 *
 * Requires DATABASE_URL env var. Finds the first user in the DB
 * and creates test trips, flights, and visited countries for them.
 */
// eslint-disable-next-line eslint-plugin-import(no-unassigned-import)
import "dotenv/config"
import { drizzle } from "drizzle-orm/node-postgres"
import { eq } from "drizzle-orm"
import * as schema from "./schema"

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error("DATABASE_URL is not set")
}

const db = drizzle(url, { schema })

const TRIPS = [
  { destination: "Tokyo, Japan", start: "2025-03-15", end: "2025-03-22" },
  { destination: "Bangkok, Thailand", start: "2025-05-10", end: "2025-05-17" },
  { destination: "Paris, France", start: "2025-07-01", end: "2025-07-08" },
  { destination: "Bali, Indonesia", start: "2025-09-20", end: "2025-09-27" },
  { destination: "Seoul, South Korea", start: "2025-11-05", end: "2025-11-12" },
  { destination: "Istanbul, Turkey", start: "2026-01-10", end: "2026-01-17" },
  { destination: "Barcelona, Spain", start: "2026-03-01", end: "2026-03-07" },
  { destination: "Melbourne, Australia", start: "2026-05-15", end: "2026-05-22" },
  { destination: "Taipei, Taiwan", start: "2026-06-10", end: "2026-06-15" },
  { destination: "London, United Kingdom", start: "2026-08-01", end: "2026-08-10" },
  { destination: "Reykjavik, Iceland", start: "2026-09-15", end: "2026-09-20" },
  { destination: "Hanoi, Vietnam", start: "2026-10-05", end: "2026-10-12" },
  { destination: "Cape Town, South Africa", start: "2026-12-20", end: "2026-12-28" },
  { destination: "Lisbon, Portugal", start: "2027-02-10", end: "2027-02-16" },
]

const FLIGHTS = [
  {
    number: "SQ638",
    date: "2025-03-15",
    dep: "SIN",
    arr: "NRT",
    airline: "Singapore Airlines",
    status: "landed",
  },
  {
    number: "SQ639",
    date: "2025-03-22",
    dep: "NRT",
    arr: "SIN",
    airline: "Singapore Airlines",
    status: "landed",
  },
  {
    number: "TG414",
    date: "2025-05-10",
    dep: "KUL",
    arr: "BKK",
    airline: "Thai Airways",
    status: "landed",
  },
  {
    number: "AF257",
    date: "2025-07-01",
    dep: "KUL",
    arr: "CDG",
    airline: "Air France",
    status: "landed",
  },
  {
    number: "QZ502",
    date: "2025-09-20",
    dep: "KUL",
    arr: "DPS",
    airline: "AirAsia",
    status: "landed",
  },
  {
    number: "KE622",
    date: "2025-11-05",
    dep: "KUL",
    arr: "ICN",
    airline: "Korean Air",
    status: "landed",
  },
  {
    number: "TK61",
    date: "2026-01-10",
    dep: "KUL",
    arr: "IST",
    airline: "Turkish Airlines",
    status: "landed",
  },
  {
    number: "TR638",
    date: "2026-05-26",
    dep: "KUL",
    arr: "SIN",
    airline: "Scoot",
    status: "scheduled",
  },
  {
    number: "CI722",
    date: "2026-06-10",
    dep: "KUL",
    arr: "TPE",
    airline: "China Airlines",
    status: "scheduled",
  },
  {
    number: "BA33",
    date: "2026-08-01",
    dep: "KUL",
    arr: "LHR",
    airline: "British Airways",
    status: "scheduled",
  },
  {
    number: "FI615",
    date: "2026-09-15",
    dep: "LHR",
    arr: "KEF",
    airline: "Icelandair",
    status: "scheduled",
  },
  {
    number: "VN656",
    date: "2026-10-05",
    dep: "KUL",
    arr: "HAN",
    airline: "Vietnam Airlines",
    status: "scheduled",
  },
  {
    number: "SA287",
    date: "2026-12-20",
    dep: "KUL",
    arr: "CPT",
    airline: "South African Airways",
    status: "scheduled",
  },
  {
    number: "TP465",
    date: "2027-02-10",
    dep: "KUL",
    arr: "LIS",
    airline: "TAP Portugal",
    status: "scheduled",
  },
]

const COUNTRIES = [
  { code: "JP", name: "Japan" },
  { code: "TH", name: "Thailand" },
  { code: "FR", name: "France" },
  { code: "ID", name: "Indonesia" },
  { code: "KR", name: "South Korea" },
  { code: "TR", name: "Turkey" },
  { code: "SG", name: "Singapore" },
  { code: "AU", name: "Australia" },
  { code: "TW", name: "Taiwan" },
  { code: "GB", name: "United Kingdom" },
]

async function seed() {
  // Find first user
  const user = await db.query.user.findFirst()
  if (!user) {
    console.error("No users found in the database. Sign up first, then run this script.")
    process.exit(1)
  }

  console.log(`Seeding test data for user: ${user.name} (${user.email})`)

  // Create trips with itinerary days
  let tripsCreated = 0
  for (const t of TRIPS) {
    const existing = await db.query.trips.findFirst({
      where: eq(schema.trips.destination, t.destination),
    })
    if (existing) {
      console.log(`  Skip trip: ${t.destination} (already exists)`)
      continue
    }

    const [trip] = await db
      .insert(schema.trips)
      .values({
        userId: user.id,
        destination: t.destination,
        startDate: t.start,
        endDate: t.end,
        status: "upcoming",
        preferences: {},
        currencyCode: "USD",
      })
      .returning()

    // Create itinerary days
    const start = new Date(t.start)
    const end = new Date(t.end)
    const numDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

    const dayValues = Array.from({ length: numDays }, (_, i) => {
      const dayDate = new Date(start)
      dayDate.setDate(dayDate.getDate() + i)
      return {
        tripId: trip!.id,
        dayNumber: i + 1,
        date: dayDate.toISOString().split("T")[0]!,
      }
    })

    await db.insert(schema.itineraryDays).values(dayValues)
    tripsCreated++
    console.log(`  Created trip: ${t.destination} (${numDays} days)`)
  }

  // Create flights (link to matching trips where possible)
  let flightsCreated = 0
  for (const f of FLIGHTS) {
    const existing = await db.query.flights.findFirst({
      where: eq(schema.flights.flightNumber, f.number),
    })
    if (existing) {
      console.log(`  Skip flight: ${f.number} (already exists)`)
      continue
    }

    // Try to find a matching trip by date
    const matchingTrip = await db.query.trips.findFirst({
      where: eq(schema.trips.startDate, f.date),
    })

    await db.insert(schema.flights).values({
      userId: user.id,
      tripId: matchingTrip?.id ?? null,
      flightNumber: f.number,
      flightDate: f.date,
      airline: f.airline,
      departureAirport: f.dep,
      arrivalAirport: f.arr,
      departureTime: new Date(`${f.date}T08:00:00Z`),
      arrivalTime: new Date(`${f.date}T14:00:00Z`),
      status: f.status,
    })
    flightsCreated++
    console.log(`  Created flight: ${f.number} (${f.dep} → ${f.arr})`)
  }

  // Add visited countries
  let countriesAdded = 0
  for (const c of COUNTRIES) {
    const existing = await db.query.visitedCountries.findFirst({
      where: eq(schema.visitedCountries.countryCode, c.code),
    })
    if (existing) continue

    await db.insert(schema.visitedCountries).values({
      userId: user.id,
      countryCode: c.code,
      countryName: c.name,
      visitType: "visited",
    })
    countriesAdded++
  }

  console.log(
    `\nDone! Created ${tripsCreated} trips, ${flightsCreated} flights, ${countriesAdded} countries.`,
  )
  process.exit(0)
}

seed().catch((e) => {
  console.error("Seed failed:", e)
  process.exit(1)
})
