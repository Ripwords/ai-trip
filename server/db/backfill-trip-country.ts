/**
 * One-shot backfill: infer `country_code` for trips where it's NULL.
 *
 * Strategy: walk each trip's activities, parse the country segment from
 * their `address` field (Google's formatted address always ends with the
 * country name), match it against our static country list, and pick the
 * most-frequent country across all activities. Skip trips with no
 * geocoded activities — the trip page banner prompts the user to set it.
 *
 * Run with: tsx server/db/backfill-trip-country.ts
 */

import { eq, isNull } from "drizzle-orm"
import { db } from "./index"
import { trips, itineraryDays } from "./schema"
import { countries, countryByAlpha2 } from "../../app/data/countries"

// Build name → alpha2 lookup, including common variants Google uses that
// don't exactly match our `country.name` field.
const NAME_ALIASES: Record<string, string> = {
  USA: "US",
  "U.S.A.": "US",
  "United States of America": "US",
  UK: "GB",
  "U.K.": "GB",
  Britain: "GB",
  "Great Britain": "GB",
  "South Korea": "KR",
  "North Korea": "KP",
  Russia: "RU",
  "Russian Federation": "RU",
  Vietnam: "VN",
  "Viet Nam": "VN",
  Czechia: "CZ",
  "Czech Republic": "CZ",
  UAE: "AE",
  "Hong Kong SAR": "HK",
  Macao: "MO",
  "Macao SAR": "MO",
  "Taiwan, Province of China": "TW",
  "Republic of China": "TW",
  "Palestine, State of": "PS",
  "Côte d'Ivoire": "CI",
  "Ivory Coast": "CI",
}

const nameToCode = new Map<string, string>()
for (const c of countries) {
  nameToCode.set(c.name.toLowerCase(), c.alpha2)
}
for (const [name, code] of Object.entries(NAME_ALIASES)) {
  nameToCode.set(name.toLowerCase(), code)
}

function extractCountryFromAddress(address: string | null): string | null {
  if (!address) return null
  // Google formatted addresses end with the country name. Some include a
  // postal code in front of the country (e.g. "Tokyo 150-0001, Japan").
  const segments = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const last = segments.at(-1)
  if (!last) return null
  // Try the whole last segment, then strip trailing postal codes/numbers.
  const candidates = [last, last.replace(/[\d\-\s]+$/, "").trim()]
  for (const cand of candidates) {
    const code = nameToCode.get(cand.toLowerCase())
    if (code) return code
  }
  return null
}

async function main() {
  const targets = await db.query.trips.findMany({
    where: isNull(trips.countryCode),
    columns: { id: true, destination: true },
  })

  console.log(`Found ${targets.length} trips with NULL country_code`)

  let updated = 0
  let skipped = 0

  for (const trip of targets) {
    const days = await db.query.itineraryDays.findMany({
      where: eq(itineraryDays.tripId, trip.id),
      columns: { id: true },
    })
    if (days.length === 0) {
      console.log(`  skip ${trip.id} (${trip.destination}) — no days`)
      skipped++
      continue
    }

    const dayIds = days.map((d) => d.id)
    const acts = await db.query.activities.findMany({
      where: (a, { inArray }) => inArray(a.itineraryDayId, dayIds),
      columns: { address: true },
    })

    const counts = new Map<string, number>()
    for (const a of acts) {
      const code = extractCountryFromAddress(a.address)
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1)
    }

    if (counts.size === 0) {
      console.log(`  skip ${trip.id} (${trip.destination}) — no addresses matched a country`)
      skipped++
      continue
    }

    // Most frequent wins
    const [winner] = [...counts.entries()].toSorted((a, b) => b[1] - a[1])
    const code = winner![0]
    if (!countryByAlpha2.has(code)) {
      console.log(`  skip ${trip.id} — derived code ${code} unknown`)
      skipped++
      continue
    }

    await db.update(trips).set({ countryCode: code }).where(eq(trips.id, trip.id))
    console.log(`  ✓ ${trip.id} (${trip.destination}) → ${code}`)
    updated++
  }

  console.log(`\nDone. Updated: ${updated}, skipped: ${skipped}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
