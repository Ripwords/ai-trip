# Passport History Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `/passport` page that renders a user's flights, distance, airports, airlines, and country history as an editorial passport view using existing `/api/flights` and `/api/visited-countries`.

**Architecture:** Pure frontend addition. A small testable utility (`app/utils/passport-history.ts`) derives the passport model from existing API payloads + airport/country lookup tables. A new `app/pages/passport.vue` consumes that utility and renders a dark-gradient passport panel, a simple inline-SVG route map, metric cards, and country/recent-flight lists. Navigation links are added to `app/layouts/app.vue` and `app/components/Nav/Mobile.vue`. No backend changes.

**Tech Stack:** Nuxt 4 (Vue 3), TypeScript, Tailwind 4, `@nuxt/icon` (lucide), `node:test` runner via `tsx` for utility tests.

**Spec:** `docs/superpowers/specs/2026-05-23-passport-history-page-design.md`

---

## File Structure

**New files:**

- `app/utils/passport-history.ts` — derives passport stats, country history, route segments from flights + visited countries (testable, no Vue imports).
- `app/utils/passport-history.test.ts` — `node:test` tests for the utility.
- `app/pages/passport.vue` — the `/passport` page. Uses the `app` layout. Fetches `/api/flights` + `/api/visited-countries`, calls the utility, renders the passport panel + lists. Inline SVG route map is rendered directly inside this single-file component (no separate component) to keep scope minimal.

**Modified files:**

- `app/layouts/app.vue` — add a desktop nav link to `/passport` next to `/flights`.
- `app/components/Nav/Mobile.vue` — add a `Passport` tab to the mobile bottom-nav tabs array.

**Unchanged:**

- `app/utils/airport-coordinates.ts`, `app/utils/iata-to-country.ts`, `app/data/countries.ts` — read-only inputs.
- `/api/flights/*`, `/api/visited-countries/*` — read endpoints only.

---

## Conventions To Follow

- TypeScript strict; no `any`. Prefer narrow types from existing modules.
- Tailwind classes only (no extra global CSS). Scoped `<style>` is fine for gradient definitions that need CSS variables.
- No native `confirm()`/`alert()` — N/A here, page is read-only.
- `bg-white` is globally overridden in dark mode; use `bg-stone-50` for guaranteed light surfaces if needed (the gradient panel is dark, so this rarely applies).
- Tests use `import assert from "node:assert/strict"` and `import { describe, it } from "node:test"`, run via `node --test --import tsx <file>`.
- Conventional commits (one commit per logical task; final feature commit at end is acceptable).

---

## Task 1: Scaffold the passport utility module + first failing test

**Files:**

- Create: `app/utils/passport-history.ts`
- Create: `app/utils/passport-history.test.ts`

- [ ] **Step 1: Write the file scaffold and the first failing test**

Create `app/utils/passport-history.ts`:

```ts
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

export function buildPassportHistory(_input: BuildPassportHistoryInput): PassportHistory {
  throw new Error("not implemented")
}
```

Create `app/utils/passport-history.test.ts`:

```ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildPassportHistory } from "./passport-history"

describe("passport history", () => {
  it("counts flights and unique airports/airlines", () => {
    const result = buildPassportHistory({
      flights: [
        {
          id: "f1",
          flightNumber: "JL5",
          flightDate: "2025-03-10",
          airline: "Japan Airlines",
          departureAirport: "JFK",
          arrivalAirport: "NRT",
          departureTime: null,
          arrivalTime: null,
        },
        {
          id: "f2",
          flightNumber: "JL6",
          flightDate: "2025-03-20",
          airline: "Japan Airlines",
          departureAirport: "NRT",
          arrivalAirport: "JFK",
          departureTime: null,
          arrivalTime: null,
        },
      ],
      visitedCountries: [],
    })

    assert.equal(result.totalFlights, 2)
    assert.deepEqual(result.uniqueAirports.toSorted(), ["JFK", "NRT"])
    assert.deepEqual(result.uniqueAirlines, ["Japan Airlines"])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: FAIL with `Error: not implemented`.

- [ ] **Step 3: Implement just enough to pass — counts + unique airports + unique airlines**

Replace the `buildPassportHistory` body in `app/utils/passport-history.ts`. Only declare what we use this task — later tasks will add `visited`/`recentLimit`:

```ts
export function buildPassportHistory(input: BuildPassportHistoryInput): PassportHistory {
  const allFlights = input.flights ?? []
  const year = input.year ?? null

  const flights =
    year == null ? allFlights : allFlights.filter((f) => yearOf(f.flightDate) === year)

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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: 1 pass.

- [ ] **Step 5: Commit**

```bash
git add app/utils/passport-history.ts app/utils/passport-history.test.ts
git commit -m "feat(passport): scaffold passport history utility with counts"
```

---

## Task 2: Distance via haversine over known airport coordinates

**Files:**

- Modify: `app/utils/passport-history.ts`
- Modify: `app/utils/passport-history.test.ts`

- [ ] **Step 1: Add a failing test for distance**

Append inside the `describe` block in `app/utils/passport-history.test.ts`:

```ts
it("sums distance only for flights with known coords and rounds to km", () => {
  const result = buildPassportHistory({
    flights: [
      {
        id: "f1",
        flightNumber: "JL5",
        flightDate: "2025-03-10",
        airline: "JL",
        departureAirport: "JFK",
        arrivalAirport: "NRT",
        departureTime: null,
        arrivalTime: null,
      },
      {
        id: "f2",
        flightNumber: "XX1",
        flightDate: "2025-04-01",
        airline: "XX",
        departureAirport: "JFK",
        arrivalAirport: "ZZZ", // unknown coord
        departureTime: null,
        arrivalTime: null,
      },
    ],
    visitedCountries: [],
  })

  // JFK -> NRT is roughly 10,840 km; allow a small tolerance.
  assert.ok(result.totalDistanceKm > 10000 && result.totalDistanceKm < 11500)
  assert.equal(Number.isInteger(result.totalDistanceKm), true)
  // Still counts the second flight even though it has no distance.
  assert.equal(result.totalFlights, 2)
})
```

- [ ] **Step 2: Run the tests and confirm the new one fails**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: previous test passes, new test fails (`totalDistanceKm` is 0).

- [ ] **Step 3: Implement haversine + route segments**

In `app/utils/passport-history.ts`, replace the `buildPassportHistory` body so distance + route segments are computed, and add helpers:

```ts
export function buildPassportHistory(input: BuildPassportHistoryInput): PassportHistory {
  const allFlights = input.flights ?? []
  const year = input.year ?? null

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

  return {
    totalFlights: flights.length,
    totalDistanceKm: Math.round(totalDistance),
    uniqueAirports,
    uniqueAirlines,
    countries: [],
    countryFlags: [],
    recentFlights: [],
    routeSegments,
    availableYears: collectYears(allFlights),
  }
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
```

- [ ] **Step 4: Run tests and confirm both pass**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: 2 passes.

- [ ] **Step 5: Commit**

```bash
git add app/utils/passport-history.ts app/utils/passport-history.test.ts
git commit -m "feat(passport): compute haversine distance and route segments"
```

---

## Task 3: Country history — union of visited + flight-derived, with precedence

**Files:**

- Modify: `app/utils/passport-history.ts`
- Modify: `app/utils/passport-history.test.ts`

- [ ] **Step 1: Add failing tests for country merge + precedence + ordering**

Append inside the `describe` block in `app/utils/passport-history.test.ts`:

```ts
it("merges visited countries with flight-derived countries, visited wins", () => {
  const result = buildPassportHistory({
    flights: [
      {
        id: "f1",
        flightNumber: "JL5",
        flightDate: "2025-03-10",
        airline: "JL",
        departureAirport: "JFK",
        arrivalAirport: "NRT", // Japan
        departureTime: null,
        arrivalTime: null,
      },
      {
        id: "f2",
        flightNumber: "BA1",
        flightDate: "2025-05-01",
        airline: "BA",
        departureAirport: "LHR", // United Kingdom
        arrivalAirport: "CDG", // France
        departureTime: null,
        arrivalTime: null,
      },
    ],
    visitedCountries: [
      { countryCode: "JP", countryName: "Japan", visitType: "visited" },
      { countryCode: "TH", countryName: "Thailand", visitType: "layover" },
    ],
  })

  // Japan should be marked as 'visited' even though it also appears in flights.
  const japan = result.countries.find((c) => c.code === "JP")
  assert.ok(japan)
  assert.equal(japan.source, "visited")

  // Thailand is layover (no flight to it).
  const thailand = result.countries.find((c) => c.code === "TH")
  assert.equal(thailand?.source, "layover")

  // France + UK come from flights only.
  assert.equal(result.countries.find((c) => c.code === "FR")?.source, "flight")
  assert.equal(result.countries.find((c) => c.code === "GB")?.source, "flight")

  // Visited first, then layover, then flight; alphabetical within each group.
  const order = result.countries.map((c) => c.code)
  const visitedIdx = order.indexOf("JP")
  const layoverIdx = order.indexOf("TH")
  const flightIdx = Math.min(order.indexOf("FR"), order.indexOf("GB"))
  assert.ok(visitedIdx < layoverIdx)
  assert.ok(layoverIdx < flightIdx)

  // countryFlags follows country order.
  assert.equal(result.countryFlags.length, result.countries.length)
})

it("falls back to country code when alpha2 is unknown", () => {
  const result = buildPassportHistory({
    flights: [],
    visitedCountries: [{ countryCode: "XX", countryName: "Nowhereland", visitType: "visited" }],
  })

  const entry = result.countries[0]
  assert.equal(entry?.code, "XX")
  assert.equal(entry?.name, "Nowhereland")
})
```

- [ ] **Step 2: Run tests and confirm new ones fail**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: 2 existing pass, 2 new ones fail (countries is empty).

- [ ] **Step 3: Implement country merge with precedence + ordering**

In `app/utils/passport-history.ts`, inside `buildPassportHistory`, add a `visited` declaration near the top (right after the `year` line):

```ts
const visited = input.visitedCountries ?? []
```

Then add the country computation right before the `return`:

```ts
const countries = mergeCountries(visited, flights, /*flightDerivedOnly*/ year != null)
const countryFlags = countries.map((c) => c.flag)
```

And the `return` block becomes:

```ts
return {
  totalFlights: flights.length,
  totalDistanceKm: Math.round(totalDistance),
  uniqueAirports,
  uniqueAirlines,
  countries,
  countryFlags,
  recentFlights: [],
  routeSegments,
  availableYears: collectYears(allFlights),
}
```

Add the helper at module scope:

```ts
const SOURCE_RANK: Record<CountrySource, number> = { visited: 0, layover: 1, flight: 2 }

function mergeCountries(
  visited: PassportVisitedCountry[],
  flights: PassportFlight[],
  flightDerivedOnly: boolean,
): PassportCountryEntry[] {
  const map = new Map<string, PassportCountryEntry>()

  if (!flightDerivedOnly) {
    for (const v of visited) {
      const code = v.countryCode.toUpperCase()
      const source: CountrySource = v.visitType === "layover" ? "layover" : "visited"
      map.set(code, {
        code,
        name: countryByAlpha2.get(code)?.name ?? v.countryName,
        flag: countryFlag(code),
        source,
      })
    }
  }

  for (const f of flights) {
    for (const airport of [f.departureAirport, f.arrivalAirport]) {
      if (!airport) continue
      const code = iataToCountry[airport]
      if (!code) continue
      if (map.has(code)) continue // visited/layover wins
      map.set(code, {
        code,
        name: countryByAlpha2.get(code)?.name ?? code,
        flag: countryFlag(code),
        source: "flight",
      })
    }
  }

  return Array.from(map.values()).toSorted((a, b) => {
    const r = SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    if (r !== 0) return r
    return a.name.localeCompare(b.name)
  })
}
```

- [ ] **Step 4: Run tests and confirm all four pass**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: 4 passes.

- [ ] **Step 5: Commit**

```bash
git add app/utils/passport-history.ts app/utils/passport-history.test.ts
git commit -m "feat(passport): merge visited and flight-derived countries"
```

---

## Task 4: Recent flights list (capped, most-recent first)

**Files:**

- Modify: `app/utils/passport-history.ts`
- Modify: `app/utils/passport-history.test.ts`

- [ ] **Step 1: Add failing test for recent flights**

Append inside the `describe` block in `app/utils/passport-history.test.ts`:

```ts
it("returns up to N most-recent flights, newest first", () => {
  const result = buildPassportHistory({
    flights: [
      mkFlight("f-old", "2023-01-10", "JFK", "LHR"),
      mkFlight("f-mid", "2024-06-15", "JFK", "CDG"),
      mkFlight("f-new", "2025-09-20", "JFK", "NRT"),
      mkFlight("f-newer", "2025-12-01", "JFK", "HND"),
      mkFlight("f-newest", "2026-02-02", "JFK", "ICN"),
    ],
    visitedCountries: [],
    recentFlightLimit: 3,
  })

  assert.deepEqual(
    result.recentFlights.map((f) => f.id),
    ["f-newest", "f-newer", "f-new"],
  )
})
```

And add this helper at the bottom of the test file (above the closing of `describe` is fine, or just outside):

```ts
function mkFlight(
  id: string,
  date: string,
  dep: string | null,
  arr: string | null,
): {
  id: string
  flightNumber: string
  flightDate: string
  airline: string | null
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
} {
  return {
    id,
    flightNumber: id.toUpperCase(),
    flightDate: date,
    airline: "Test Air",
    departureAirport: dep,
    arrivalAirport: arr,
    departureTime: null,
    arrivalTime: null,
  }
}
```

- [ ] **Step 2: Run tests and confirm the new one fails**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: 4 pass, 1 fail (recentFlights is empty).

- [ ] **Step 3: Implement recentFlights**

In `app/utils/passport-history.ts`, inside `buildPassportHistory`, add a `recentLimit` declaration near the top (right after the `visited` line added in Task 3):

```ts
const recentLimit = Math.max(1, Math.min(5, input.recentFlightLimit ?? 4))
```

Then add this before the `return`:

```ts
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
```

Then update the `return` to use it:

```ts
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
```

- [ ] **Step 4: Run tests and confirm all five pass**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: 5 passes.

- [ ] **Step 5: Commit**

```bash
git add app/utils/passport-history.ts app/utils/passport-history.test.ts
git commit -m "feat(passport): expose recent flights capped list"
```

---

## Task 5: Year filtering — flight-derived only in year mode

**Files:**

- Modify: `app/utils/passport-history.test.ts` (verify already-implemented year filter behavior)

- [ ] **Step 1: Add failing test for year filtering**

Append inside the `describe` block in `app/utils/passport-history.test.ts`:

```ts
it("filters flight-derived data by year and hides visited-only countries in year mode", () => {
  const all = buildPassportHistory({
    flights: [mkFlight("a", "2024-03-01", "JFK", "NRT"), mkFlight("b", "2025-05-01", "JFK", "CDG")],
    visitedCountries: [{ countryCode: "TH", countryName: "Thailand", visitType: "visited" }],
  })
  assert.equal(all.totalFlights, 2)
  assert.ok(all.countries.some((c) => c.code === "TH"))
  assert.deepEqual(all.availableYears, [2025, 2024])

  const y2025 = buildPassportHistory({
    flights: [mkFlight("a", "2024-03-01", "JFK", "NRT"), mkFlight("b", "2025-05-01", "JFK", "CDG")],
    visitedCountries: [{ countryCode: "TH", countryName: "Thailand", visitType: "visited" }],
    year: 2025,
  })
  assert.equal(y2025.totalFlights, 1)
  // Thailand (visited-only) should NOT appear in year mode.
  assert.equal(
    y2025.countries.find((c) => c.code === "TH"),
    undefined,
  )
  // France should appear (flight-derived in 2025).
  assert.ok(y2025.countries.some((c) => c.code === "FR"))
  // availableYears still reflects ALL flights, not the filtered set.
  assert.deepEqual(y2025.availableYears, [2025, 2024])
})
```

- [ ] **Step 2: Run all tests**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: 6 passes (year filter and `flightDerivedOnly` precedence are already wired from Tasks 1-3).

If the test fails because `availableYears` isn't sorted descending or visited bleeds into year mode, fix the offending helper in `app/utils/passport-history.ts` until the test passes.

- [ ] **Step 3: Commit**

```bash
git add app/utils/passport-history.test.ts
git commit -m "test(passport): lock year-filter and visited-country precedence"
```

---

## Task 6: Empty-input safety test (defensive — should already pass)

**Files:**

- Modify: `app/utils/passport-history.test.ts`

- [ ] **Step 1: Add test asserting null-safety**

Append inside the `describe` block in `app/utils/passport-history.test.ts`:

```ts
it("returns zeroed values for empty / nullish input", () => {
  const r = buildPassportHistory({ flights: null, visitedCountries: null })
  assert.equal(r.totalFlights, 0)
  assert.equal(r.totalDistanceKm, 0)
  assert.deepEqual(r.uniqueAirports, [])
  assert.deepEqual(r.uniqueAirlines, [])
  assert.deepEqual(r.countries, [])
  assert.deepEqual(r.countryFlags, [])
  assert.deepEqual(r.recentFlights, [])
  assert.deepEqual(r.routeSegments, [])
  assert.deepEqual(r.availableYears, [])
})
```

- [ ] **Step 2: Run tests**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: 7 passes.

- [ ] **Step 3: Commit**

```bash
git add app/utils/passport-history.test.ts
git commit -m "test(passport): cover empty input case"
```

---

## Task 7: Create the `/passport` page (loading + empty + happy path)

**Files:**

- Create: `app/pages/passport.vue`

- [ ] **Step 1: Write the page**

Create `app/pages/passport.vue` with the full implementation below. It:

- Uses the `app` layout.
- Fetches `/api/flights` and `/api/visited-countries` with `useLazyFetch` (matches `dashboard.vue`).
- Computes a `PassportHistory` reactively via `buildPassportHistory`, switching on a `selectedYear` ref (`null` = all-time).
- Renders the dark gradient passport panel, an inline SVG world-equirectangular route map, primary metrics, country card with flags, recent-flights list, and an empty state.
- Handles partial failures: each API has its own `error`; either failure renders a small inline note without removing the rest.

```vue
<script setup lang="ts">
import { buildPassportHistory } from "../utils/passport-history"
import type {
  PassportFlight,
  PassportRouteSegment,
  PassportVisitedCountry,
} from "../utils/passport-history"

definePageMeta({ layout: "app" })
useSeoMeta({
  title: "Travel Passport",
  description: "Your flights, distance, and country history in one passport view.",
})

const {
  data: flightsData,
  status: flightsStatus,
  error: flightsError,
} = useLazyFetch<PassportFlight[]>("/api/flights")

const {
  data: visitedData,
  status: visitedStatus,
  error: visitedError,
} = useLazyFetch<PassportVisitedCountry[]>("/api/visited-countries")

const selectedYear = ref<number | null>(null)

const passport = computed(() =>
  buildPassportHistory({
    flights: flightsData.value ?? [],
    visitedCountries: visitedData.value ?? [],
    year: selectedYear.value,
    recentFlightLimit: 4,
  }),
)

const isLoading = computed(
  () => flightsStatus.value === "pending" || visitedStatus.value === "pending",
)

const hasAnyData = computed(
  () => passport.value.totalFlights > 0 || passport.value.countries.length > 0,
)

const formattedDistance = computed(() =>
  new Intl.NumberFormat("en-US").format(passport.value.totalDistanceKm),
)

function formatPeriod(): string {
  return selectedYear.value == null ? "All time" : String(selectedYear.value)
}

// Map projection: equirectangular over a 1000x500 viewBox.
function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng + 180) / 360) * 1000
  const y = ((90 - lat) / 180) * 500
  return { x, y }
}

function segmentPath(seg: PassportRouteSegment): string {
  const a = project(seg.from.lat, seg.from.lng)
  const b = project(seg.to.lat, seg.to.lng)
  // Quadratic curve with a slight upward arc to suggest a great-circle.
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2 - Math.abs(b.x - a.x) * 0.12
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`
}

const uniqueMapPoints = computed(() => {
  const map = new Map<string, { code: string; x: number; y: number }>()
  for (const seg of passport.value.routeSegments) {
    for (const p of [seg.from, seg.to]) {
      if (map.has(p.code)) continue
      const { x, y } = project(p.lat, p.lng)
      map.set(p.code, { code: p.code, x, y })
    }
  }
  return Array.from(map.values())
})
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-terra-500">Passport</p>
        <h1 class="mt-1 font-display text-3xl text-sand-900 sm:text-4xl">Travel Passport</h1>
        <p class="mt-1 text-sm text-sand-600">{{ formatPeriod() }}</p>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <button
          type="button"
          class="rounded-full border border-sand-200 px-3 py-1 text-xs font-semibold transition"
          :class="
            selectedYear == null
              ? 'bg-sand-900 text-sand-50'
              : 'bg-white/70 text-sand-700 hover:bg-sand-100'
          "
          @click="selectedYear = null"
        >
          All time
        </button>
        <button
          v-for="year in passport.availableYears"
          :key="year"
          type="button"
          class="rounded-full border border-sand-200 px-3 py-1 text-xs font-semibold transition"
          :class="
            selectedYear === year
              ? 'bg-sand-900 text-sand-50'
              : 'bg-white/70 text-sand-700 hover:bg-sand-100'
          "
          @click="selectedYear = year"
        >
          {{ year }}
        </button>
      </div>
    </header>

    <!-- Loading skeleton -->
    <div
      v-if="isLoading && !hasAnyData"
      class="passport-shell min-h-[420px] animate-pulse rounded-3xl"
      aria-hidden="true"
    />

    <!-- Empty state -->
    <section
      v-else-if="!hasAnyData"
      class="passport-shell flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-3xl px-6 py-10 text-center"
    >
      <Icon name="lucide:stamp" class="h-8 w-8 text-terra-300" />
      <h2 class="font-display text-2xl text-sand-50">Your passport is empty</h2>
      <p class="max-w-md text-sm text-sand-300">
        Add flights or mark countries to start building your travel ledger.
      </p>
      <div class="mt-2 flex flex-wrap justify-center gap-2">
        <NuxtLink
          to="/flights"
          class="rounded-full bg-terra-500 px-4 py-2 text-xs font-semibold text-sand-50 transition hover:bg-terra-400"
        >
          Add flights
        </NuxtLink>
        <NuxtLink
          to="/explore"
          class="rounded-full border border-sand-50/30 px-4 py-2 text-xs font-semibold text-sand-50 transition hover:bg-sand-50/10"
        >
          Mark countries
        </NuxtLink>
      </div>
    </section>

    <!-- Passport panel -->
    <section v-else class="passport-shell rounded-3xl p-5 sm:p-7">
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <!-- Left: route map + primary metrics -->
        <div class="flex flex-col gap-5">
          <div class="passport-map-frame relative overflow-hidden rounded-2xl">
            <svg
              viewBox="0 0 1000 500"
              preserveAspectRatio="xMidYMid meet"
              class="block h-auto w-full"
              role="img"
              aria-label="Route map"
            >
              <defs>
                <pattern
                  id="passport-grid"
                  x="0"
                  y="0"
                  width="50"
                  height="50"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M50 0H0V50"
                    fill="none"
                    stroke="rgba(214,193,168,0.08)"
                    stroke-width="0.5"
                  />
                </pattern>
              </defs>
              <rect width="1000" height="500" fill="url(#passport-grid)" />
              <path
                v-for="seg in passport.routeSegments"
                :key="seg.flightId"
                :d="segmentPath(seg)"
                fill="none"
                stroke="rgba(213,143,93,0.85)"
                stroke-width="1.4"
                stroke-linecap="round"
              />
              <g v-for="point in uniqueMapPoints" :key="point.code">
                <circle :cx="point.x" :cy="point.y" r="3" fill="#f0c896" />
                <text
                  :x="point.x + 6"
                  :y="point.y - 4"
                  font-size="10"
                  fill="rgba(240,200,150,0.85)"
                  font-family="ui-monospace, SFMono-Regular, monospace"
                >
                  {{ point.code }}
                </text>
              </g>
            </svg>
            <p
              v-if="passport.routeSegments.length === 0"
              class="absolute inset-0 flex items-center justify-center text-xs text-sand-300"
            >
              No mappable routes yet
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="passport-metric">
              <p class="passport-metric-label">Flights</p>
              <p class="passport-metric-value tabular-nums">{{ passport.totalFlights }}</p>
            </div>
            <div class="passport-metric">
              <p class="passport-metric-label">Flight distance</p>
              <p class="passport-metric-value tabular-nums">
                {{ formattedDistance }}<span class="passport-metric-unit">km</span>
              </p>
            </div>
          </div>
        </div>

        <!-- Right: country / airports / airlines -->
        <div class="flex flex-col gap-3">
          <div class="passport-metric">
            <div class="flex items-baseline justify-between">
              <p class="passport-metric-label">Countries</p>
              <p class="passport-metric-value tabular-nums">{{ passport.countries.length }}</p>
            </div>
            <div
              v-if="passport.countryFlags.length"
              class="mt-3 flex flex-wrap gap-1 text-xl leading-none"
              aria-hidden="true"
            >
              <span
                v-for="(flag, i) in passport.countryFlags.slice(0, 24)"
                :key="passport.countries[i]?.code ?? i"
              >
                {{ flag }}
              </span>
              <span v-if="passport.countryFlags.length > 24" class="text-xs text-sand-300">
                +{{ passport.countryFlags.length - 24 }}
              </span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="passport-metric">
              <p class="passport-metric-label">Airports</p>
              <p class="passport-metric-value tabular-nums">
                {{ passport.uniqueAirports.length }}
              </p>
            </div>
            <div class="passport-metric">
              <p class="passport-metric-label">Airlines</p>
              <p class="passport-metric-value tabular-nums">
                {{ passport.uniqueAirlines.length }}
              </p>
            </div>
          </div>

          <p
            v-if="flightsError || visitedError"
            class="rounded-xl bg-terra-500/15 px-3 py-2 text-xs text-terra-100"
          >
            <template v-if="flightsError">Couldn't load flights. </template>
            <template v-if="visitedError">Couldn't load visited countries.</template>
          </p>
        </div>
      </div>
    </section>

    <!-- Country history + Recent flights -->
    <section v-if="hasAnyData" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="rounded-2xl border border-sand-200 bg-white/70 p-5">
        <div class="mb-3 flex items-baseline justify-between">
          <h2 class="font-display text-lg text-sand-900">Country history</h2>
          <p class="text-xs text-sand-500">{{ passport.countries.length }} total</p>
        </div>
        <ul v-if="passport.countries.length" class="divide-y divide-sand-100">
          <li
            v-for="country in passport.countries"
            :key="country.code"
            class="flex items-center justify-between py-2 text-sm"
          >
            <span class="flex items-center gap-3 text-sand-800">
              <span class="text-lg leading-none" aria-hidden="true">{{ country.flag }}</span>
              <span>{{ country.name }}</span>
            </span>
            <span class="text-[10px] font-semibold uppercase tracking-wide text-sand-400">
              {{ country.source }}
            </span>
          </li>
        </ul>
        <p v-else class="text-sm text-sand-500">No countries yet.</p>
      </div>

      <div class="rounded-2xl border border-sand-200 bg-white/70 p-5">
        <div class="mb-3 flex items-baseline justify-between">
          <h2 class="font-display text-lg text-sand-900">Recent flights</h2>
          <NuxtLink to="/flights" class="text-xs font-semibold text-terra-600 hover:text-terra-700">
            View all
          </NuxtLink>
        </div>
        <ul v-if="passport.recentFlights.length" class="divide-y divide-sand-100">
          <li
            v-for="flight in passport.recentFlights"
            :key="flight.id"
            class="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <span class="flex min-w-0 items-center gap-3">
              <span class="font-mono text-xs text-sand-500">{{ flight.flightNumber }}</span>
              <span class="truncate text-sand-800">
                {{ flight.departureAirport ?? "???" }} → {{ flight.arrivalAirport ?? "???" }}
              </span>
            </span>
            <NuxtTime
              :datetime="flight.flightDate + 'T00:00:00'"
              locale="en-US"
              month="short"
              day="numeric"
              year="numeric"
              class="shrink-0 text-xs text-sand-500"
            />
          </li>
        </ul>
        <p v-else class="text-sm text-sand-500">No flights in this period.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.passport-shell {
  background: linear-gradient(120deg, #33211d 0%, #1d2d2b 58%, #131815 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 22px 50px rgba(0, 0, 0, 0.22);
  color: #f3e8d8;
}

.passport-map-frame {
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(213, 143, 93, 0.08), transparent 60%),
    rgba(20, 26, 26, 0.55);
  border: 1px solid rgba(213, 143, 93, 0.18);
}

.passport-metric {
  background: rgba(245, 233, 215, 0.06);
  border: 1px solid rgba(245, 233, 215, 0.1);
  border-radius: 1rem;
  padding: 0.9rem 1rem;
  backdrop-filter: blur(4px);
}

.passport-metric-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(213, 143, 93, 0.9);
}

.passport-metric-value {
  font-family: ui-serif, Georgia, serif;
  font-size: 1.85rem;
  line-height: 1.1;
  color: #f5e9d7;
  margin-top: 0.35rem;
  word-break: break-word;
}

.passport-metric-unit {
  margin-left: 0.25rem;
  font-size: 0.8rem;
  color: rgba(245, 233, 215, 0.6);
  font-family: ui-sans-serif, system-ui, sans-serif;
}
</style>
```

- [ ] **Step 2: Confirm Nuxt picks up the new page**

Run: `bun run lint app/pages/passport.vue` (or `bun run lint`)
Expected: no errors (warnings ok). If oxlint flags `mkFlight` as unused — it isn't, it's only used inside the test file — that's fine for this step.

- [ ] **Step 3: Commit**

```bash
git add app/pages/passport.vue
git commit -m "feat(passport): add /passport editorial passport page"
```

---

## Task 8: Wire desktop nav link

**Files:**

- Modify: `app/layouts/app.vue`

- [ ] **Step 1: Add a Passport link in the desktop nav, between Explore and Flights**

In `app/layouts/app.vue`, immediately after the `</NuxtLink>` for the `/explore` link (the block that contains `lucide:globe` + the label `Explore`), add:

```vue
<NuxtLink
  to="/passport"
  class="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-sand-500 transition hover:bg-sand-100 hover:text-sand-700 sm:flex dark:text-sand-400 dark:hover:bg-sand-800 dark:hover:text-sand-200"
  active-class="bg-sand-100 text-sand-900 dark:bg-sand-800 dark:text-sand-100"
>
            <Icon name="lucide:stamp" class="h-4 w-4" />
            <span>Passport</span>
          </NuxtLink>
```

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/layouts/app.vue
git commit -m "feat(passport): add desktop nav link"
```

---

## Task 9: Wire mobile nav tab

**Files:**

- Modify: `app/components/Nav/Mobile.vue`

- [ ] **Step 1: Add a Passport tab to the mobile tab array**

Replace the `tabs` definition in `app/components/Nav/Mobile.vue` with:

```ts
const tabs = [
  { label: "Trips", icon: "lucide:map", to: "/dashboard" },
  { label: "Explore", icon: "lucide:globe", to: "/explore" },
  { label: "Flights", icon: "lucide:plane", to: "/flights" },
  { label: "Passport", icon: "lucide:stamp", to: "/passport" },
]
```

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/Nav/Mobile.vue
git commit -m "feat(passport): add mobile nav tab"
```

---

## Task 10: Format, lint, and run all tests

**Files:** none changed; verification only.

- [ ] **Step 1: Format the new + modified files**

Run: `bun run fmt`
Expected: completes; minor reflows allowed.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: no new errors. (Existing `server/lib/itinerary-review-ai.ts` warning is pre-existing per the user's note — ignore.)

- [ ] **Step 3: Run the passport utility tests**

Run: `node --test --import tsx app/utils/passport-history.test.ts`
Expected: 7 passes, 0 failures.

- [ ] **Step 4: Run the existing utility test to confirm no regression**

Run: `node --test --import tsx app/utils/dashboard-briefing.test.ts`
Expected: 4 passes, 0 failures.

- [ ] **Step 5: Commit any format changes (if any)**

```bash
git status
# If files were reformatted by fmt, commit them:
git add -u
git commit -m "chore(passport): apply formatter"
```

(If `git status` shows a clean tree after fmt, skip the commit.)

---

## Done

After Task 10:

- `/passport` route renders the editorial passport view from real `/api/flights` + `/api/visited-countries` data.
- Desktop nav and mobile bottom-nav include a Passport link.
- 7 utility tests cover counts, distance, country merge precedence, recent flights, year filtering, and empty-input safety.
- No backend changes, no schema changes, no out-of-scope work (no editing, no snapshots, no export).
