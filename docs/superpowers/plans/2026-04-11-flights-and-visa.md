# Flight Details & Visa Requirements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add flight tracking with live details (gates, delays, status) and automatic visa requirement badges based on user passports, backed by AeroDataBox API and the Passport Index Dataset.

**Architecture:** New `userPassports`, `flights`, and `visaRequirements` Drizzle tables. Flight data fetched from AeroDataBox with 2-hour stale-while-revalidate caching. Visa data imported from an open-source CSV dataset into the DB — zero external API calls for visa lookups. Frontend adds a top-level "My Flights" page and a Flights tab on trip detail.

**Tech Stack:** Nuxt 3, Drizzle ORM (PostgreSQL), AeroDataBox API (via RapidAPI), Passport Index Dataset (CSV), Vue 3, TailwindCSS

---

## File Structure

### New Files

| File                                       | Responsibility                                    |
| ------------------------------------------ | ------------------------------------------------- |
| `server/db/schema/user-passports.ts`       | Drizzle schema for `user_passports` table         |
| `server/db/schema/flights.ts`              | Drizzle schema for `flights` table                |
| `server/db/schema/visa-requirements.ts`    | Drizzle schema for `visa_requirements` table      |
| `server/api/user/passports/index.get.ts`   | List user's passports                             |
| `server/api/user/passports/index.post.ts`  | Add a passport                                    |
| `server/api/user/passports/[id].patch.ts`  | Update passport (label, default)                  |
| `server/api/user/passports/[id].delete.ts` | Delete a passport                                 |
| `server/api/flights/index.get.ts`          | List user's flights                               |
| `server/api/flights/index.post.ts`         | Add a flight                                      |
| `server/api/flights/[id].get.ts`           | Get single flight (fresh-on-load)                 |
| `server/api/flights/[id].patch.ts`         | Update flight (link/unlink trip)                  |
| `server/api/flights/[id].delete.ts`        | Delete a flight                                   |
| `server/api/trips/[id]/flights.get.ts`     | Get flights for a trip                            |
| `server/lib/flight-api.ts`                 | AeroDataBox API wrapper with caching              |
| `server/utils/iata-country-map.ts`         | IATA airport code to ISO alpha-2 country mapping  |
| `server/tasks/import-visa-data.ts`         | Nuxt server task to import Passport Index Dataset |
| `app/pages/flights.vue`                    | My Flights page                                   |
| `app/components/FlightCard.vue`            | Flight card component                             |
| `app/components/PassportManager.vue`       | Passport CRUD in settings                         |
| `app/components/VisaBadge.vue`             | Small visa status badge                           |

### Modified Files

| File                            | Change                                                    |
| ------------------------------- | --------------------------------------------------------- |
| `server/db/schema/index.ts`     | Export new schemas                                        |
| `server/utils/schemas.ts`       | Add Zod schemas for flights and passports                 |
| `server/api/visa/check.post.ts` | Rewrite to use `visa_requirements` table + multi-passport |
| `app/layouts/app.vue`           | Add "Flights" nav link                                    |
| `app/pages/settings.vue`        | Add PassportManager section                               |
| `app/pages/trips/[id].vue`      | Add "Flights" tab                                         |

---

## Task 1: `user_passports` Schema & Migration

**Files:**

- Create: `server/db/schema/user-passports.ts`
- Modify: `server/db/schema/index.ts`

- [ ] **Step 1: Create the schema file**

Create `server/db/schema/user-passports.ts`:

```typescript
import { pgTable, text, timestamp, uuid, boolean, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { user } from "./auth-schema"

export const userPassports = pgTable(
  "user_passports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    countryCode: text("country_code").notNull(), // ISO alpha-2
    label: text("label"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_user_passports_user_country").on(table.userId, table.countryCode)],
)

export const userPassportsRelations = relations(userPassports, ({ one }) => ({
  user: one(user, { fields: [userPassports.userId], references: [user.id] }),
}))
```

- [ ] **Step 2: Export from schema index**

In `server/db/schema/index.ts`, add at the end:

```typescript
export * from "./user-passports"
```

- [ ] **Step 3: Generate and run the migration**

Run:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

Expected: Migration creates `user_passports` table with the unique index.

- [ ] **Step 4: Seed from existing nationality data**

Run this SQL or add to the migration to seed `user_passports` from existing `user_profiles.nationality`:

```sql
INSERT INTO user_passports (id, user_id, country_code, is_default, created_at)
SELECT gen_random_uuid(), up.user_id, up.nationality, true, NOW()
FROM user_profiles up
WHERE up.nationality IS NOT NULL
ON CONFLICT (user_id, country_code) DO NOTHING;
```

If using Drizzle's migration runner, add this as a custom SQL migration file or run it manually after the migration.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/user-passports.ts server/db/schema/index.ts drizzle/
git commit -m "feat: add user_passports schema, migration, and seed from existing nationality"
```

---

## Task 2: `flights` Schema & Migration

**Files:**

- Create: `server/db/schema/flights.ts`
- Modify: `server/db/schema/index.ts`

- [ ] **Step 1: Create the schema file**

Create `server/db/schema/flights.ts`:

```typescript
import {
  pgTable,
  text,
  timestamp,
  date,
  uuid,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { user } from "./auth-schema"
import { trips } from "./trips"

export const flights = pgTable(
  "flights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
    flightNumber: text("flight_number").notNull(),
    flightDate: date("flight_date").notNull(),
    airline: text("airline"),
    departureAirport: text("departure_airport"),
    arrivalAirport: text("arrival_airport"),
    departureTime: timestamp("departure_time", { withTimezone: true }),
    arrivalTime: timestamp("arrival_time", { withTimezone: true }),
    terminal: text("terminal"),
    gate: text("gate"),
    status: text("status").notNull().default("scheduled"),
    rawApiResponse: jsonb("raw_api_response"),
    apiLastFetchedAt: timestamp("api_last_fetched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_flights_user_flight_date").on(
      table.userId,
      table.flightNumber,
      table.flightDate,
    ),
    index("idx_flights_user_id").on(table.userId),
    index("idx_flights_trip_id").on(table.tripId),
  ],
)

export const flightsRelations = relations(flights, ({ one }) => ({
  user: one(user, { fields: [flights.userId], references: [user.id] }),
  trip: one(trips, { fields: [flights.tripId], references: [trips.id] }),
}))
```

- [ ] **Step 2: Export from schema index**

In `server/db/schema/index.ts`, add:

```typescript
export * from "./flights"
```

- [ ] **Step 3: Generate and run the migration**

Run:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

Expected: Migration creates `flights` table with indexes.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema/flights.ts server/db/schema/index.ts drizzle/
git commit -m "feat: add flights schema and migration"
```

---

## Task 3: `visa_requirements` Schema & Migration

**Files:**

- Create: `server/db/schema/visa-requirements.ts`
- Modify: `server/db/schema/index.ts`

- [ ] **Step 1: Create the schema file**

Create `server/db/schema/visa-requirements.ts`:

```typescript
import { pgTable, text, timestamp, uuid, integer, uniqueIndex } from "drizzle-orm/pg-core"

export const visaRequirements = pgTable(
  "visa_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passportCountry: text("passport_country").notNull(), // ISO alpha-2
    destinationCountry: text("destination_country").notNull(), // ISO alpha-2
    visaStatus: text("visa_status").notNull(), // visa-free, visa-required, evisa, visa-on-arrival
    maxStayDays: integer("max_stay_days"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_visa_req_lookup").on(table.passportCountry, table.destinationCountry),
  ],
)
```

- [ ] **Step 2: Export from schema index**

In `server/db/schema/index.ts`, add:

```typescript
export * from "./visa-requirements"
```

- [ ] **Step 3: Generate and run the migration**

Run:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

- [ ] **Step 4: Commit**

```bash
git add server/db/schema/visa-requirements.ts server/db/schema/index.ts drizzle/
git commit -m "feat: add visa_requirements schema and migration"
```

---

## Task 4: Zod Validation Schemas

**Files:**

- Modify: `server/utils/schemas.ts`

- [ ] **Step 1: Add passport and flight schemas**

Add to the end of `server/utils/schemas.ts`:

```typescript
// Passports
export const createPassportSchema = z.object({
  countryCode: z.string().length(2).toUpperCase(),
  label: z.string().max(100).nullish(),
  isDefault: z.boolean().optional(),
})

export const updatePassportSchema = z.object({
  label: z.string().max(100).nullish(),
  isDefault: z.boolean().optional(),
})

// Flights
export const createFlightSchema = z.object({
  flightNumber: z
    .string()
    .min(3)
    .max(10)
    .transform((v) => v.toUpperCase().replace(/\s/g, "")),
  flightDate: z.string().date(),
  tripId: z.string().uuid().nullish(),
})

export const updateFlightSchema = z.object({
  tripId: z.string().uuid().nullish(),
})

// Visa check (new GET-based)
export const visaCheckQuerySchema = z.object({
  destination: z.string().length(2).toUpperCase(),
})
```

- [ ] **Step 2: Commit**

```bash
git add server/utils/schemas.ts
git commit -m "feat: add Zod schemas for passports, flights, and visa check"
```

---

## Task 5: IATA-to-Country Mapping

**Files:**

- Create: `server/utils/iata-country-map.ts`

- [ ] **Step 1: Create the mapping file**

Create `server/utils/iata-country-map.ts`. This is a `Record<string, string>` mapping major IATA airport codes to ISO alpha-2 country codes. Include ~200 of the busiest airports worldwide. The mapping is used to resolve visa requirements from an arrival airport code.

```typescript
/**
 * Maps IATA airport codes to ISO 3166-1 alpha-2 country codes.
 * Covers the ~200 busiest airports worldwide. If an airport is missing,
 * the visa badge simply won't show — no runtime error.
 */
export const iataToCountry: Record<string, string> = {
  // United States
  ATL: "US",
  LAX: "US",
  ORD: "US",
  DFW: "US",
  DEN: "US",
  JFK: "US",
  SFO: "US",
  SEA: "US",
  LAS: "US",
  MCO: "US",
  EWR: "US",
  MIA: "US",
  IAH: "US",
  BOS: "US",
  MSP: "US",
  DTW: "US",
  PHL: "US",
  CLT: "US",
  IAD: "US",
  SAN: "US",
  HNL: "US",
  // United Kingdom
  LHR: "GB",
  LGW: "GB",
  STN: "GB",
  MAN: "GB",
  EDI: "GB",
  // Japan
  NRT: "JP",
  HND: "JP",
  KIX: "JP",
  CTS: "JP",
  FUK: "JP",
  NGO: "JP",
  // China
  PEK: "CN",
  PVG: "CN",
  CAN: "CN",
  CTU: "CN",
  SZX: "CN",
  HKG: "HK",
  // South Korea
  ICN: "KR",
  GMP: "KR",
  PUS: "KR",
  // Singapore
  SIN: "SG",
  // Thailand
  BKK: "TH",
  DMK: "TH",
  CNX: "TH",
  HKT: "TH",
  // Malaysia
  KUL: "MY",
  PEN: "MY",
  BKI: "MY",
  KCH: "MY",
  LGK: "MY",
  SZB: "MY",
  // Indonesia
  CGK: "ID",
  DPS: "ID",
  SUB: "ID",
  // Vietnam
  SGN: "VN",
  HAN: "VN",
  DAD: "VN",
  // Philippines
  MNL: "PH",
  CEB: "PH",
  // India
  DEL: "IN",
  BOM: "IN",
  BLR: "IN",
  MAA: "IN",
  CCU: "IN",
  HYD: "IN",
  // Australia
  SYD: "AU",
  MEL: "AU",
  BNE: "AU",
  PER: "AU",
  // New Zealand
  AKL: "NZ",
  CHC: "NZ",
  WLG: "NZ",
  // UAE
  DXB: "AE",
  AUH: "AE",
  SHJ: "AE",
  // Turkey
  IST: "TR",
  SAW: "TR",
  AYT: "TR",
  // Germany
  FRA: "DE",
  MUC: "DE",
  BER: "DE",
  DUS: "DE",
  HAM: "DE",
  // France
  CDG: "FR",
  ORY: "FR",
  NCE: "FR",
  LYS: "FR",
  // Netherlands
  AMS: "NL",
  // Spain
  MAD: "ES",
  BCN: "ES",
  PMI: "ES",
  AGP: "ES",
  // Italy
  FCO: "IT",
  MXP: "IT",
  VCE: "IT",
  NAP: "IT",
  // Portugal
  LIS: "PT",
  OPO: "PT",
  // Switzerland
  ZRH: "CH",
  GVA: "CH",
  // Austria
  VIE: "AT",
  // Belgium
  BRU: "BE",
  // Ireland
  DUB: "IE",
  // Denmark
  CPH: "DK",
  // Sweden
  ARN: "SE",
  // Norway
  OSL: "NO",
  // Finland
  HEL: "FI",
  // Greece
  ATH: "GR",
  // Czech Republic
  PRG: "CZ",
  // Poland
  WAW: "PL",
  KRK: "PL",
  // Hungary
  BUD: "HU",
  // Canada
  YYZ: "CA",
  YVR: "CA",
  YUL: "CA",
  YYC: "CA",
  // Mexico
  MEX: "MX",
  CUN: "MX",
  GDL: "MX",
  // Brazil
  GRU: "BR",
  GIG: "BR",
  // Argentina
  EZE: "AR",
  // Chile
  SCL: "CL",
  // Colombia
  BOG: "CO",
  // Peru
  LIM: "PE",
  // South Africa
  JNB: "ZA",
  CPT: "ZA",
  // Egypt
  CAI: "EG",
  // Morocco
  CMN: "MA",
  // Kenya
  NBO: "KE",
  // Ethiopia
  ADD: "ET",
  // Qatar
  DOH: "QA",
  // Saudi Arabia
  RUH: "SA",
  JED: "SA",
  // Israel
  TLV: "IL",
  // Russia
  SVO: "RU",
  DME: "RU",
  LED: "RU",
  // Taiwan
  TPE: "TW",
  TSA: "TW",
  // Cambodia
  PNH: "KH",
  REP: "KH",
  // Myanmar
  RGN: "MM",
  // Sri Lanka
  CMB: "LK",
  // Maldives
  MLE: "MV",
  // Nepal
  KTM: "NP",
  // Bangladesh
  DAC: "BD",
  // Pakistan
  ISB: "PK",
  KHI: "PK",
  LHE: "PK",
  // Fiji
  NAN: "FJ",
  // Iceland
  KEF: "IS",
  // Croatia
  ZAG: "HR",
  DBV: "HR",
  SPU: "HR",
  // Romania
  OTP: "RO",
  // Bulgaria
  SOF: "BG",
  // Serbia
  BEG: "RS",
  // Laos
  VTE: "LA",
  LPQ: "LA",
}

/**
 * Resolve the country code for an IATA airport code.
 * Returns undefined if the airport is not in the map.
 */
export function getCountryForAirport(iataCode: string): string | undefined {
  return iataToCountry[iataCode.toUpperCase()]
}
```

- [ ] **Step 2: Commit**

```bash
git add server/utils/iata-country-map.ts
git commit -m "feat: add IATA-to-country mapping for visa badge resolution"
```

---

## Task 6: Visa Dataset Import Task

**Files:**

- Create: `server/tasks/import-visa-data.ts`

- [ ] **Step 1: Create the import task**

Create `server/tasks/import-visa-data.ts`:

```typescript
import { db } from "../db"
import { visaRequirements } from "../db/schema"
import { sql } from "drizzle-orm"

const DATASET_URL =
  "https://raw.githubusercontent.com/ilyankou/passport-index-dataset/master/passport-index-tidy.csv"

interface VisaRow {
  passportCountry: string
  destinationCountry: string
  visaStatus: string
  maxStayDays: number | null
}

function normalizeStatus(raw: string): { visaStatus: string; maxStayDays: number | null } {
  const trimmed = raw.trim().toLowerCase()

  // Numeric values = visa-free with that many days
  const num = parseInt(trimmed, 10)
  if (!isNaN(num) && num > 0) {
    return { visaStatus: "visa-free", maxStayDays: num }
  }

  if (trimmed === "-1" || trimmed === "visa required") {
    return { visaStatus: "visa-required", maxStayDays: null }
  }

  if (trimmed === "visa free" || trimmed === "vf") {
    return { visaStatus: "visa-free", maxStayDays: null }
  }

  if (trimmed === "visa on arrival" || trimmed === "voa") {
    return { visaStatus: "visa-on-arrival", maxStayDays: null }
  }

  if (trimmed === "e-visa" || trimmed === "eta" || trimmed === "evisa") {
    return { visaStatus: "evisa", maxStayDays: null }
  }

  // Fallback: treat unknown as visa-required
  return { visaStatus: "visa-required", maxStayDays: null }
}

function parseCsv(text: string): VisaRow[] {
  const lines = text.split("\n")
  const header = lines[0]
  if (!header) return []

  const cols = header.split(",").map((c) => c.trim())
  const passportIdx = cols.indexOf("Passport")
  const destinationIdx = cols.indexOf("Destination")
  const valueIdx = cols.indexOf("Value")

  if (passportIdx === -1 || destinationIdx === -1 || valueIdx === -1) {
    throw new Error(
      `Unexpected CSV headers: ${cols.join(", ")}. Expected: Passport, Destination, Value`,
    )
  }

  const rows: VisaRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue

    const parts = line.split(",")
    const passport = parts[passportIdx]?.trim()
    const destination = parts[destinationIdx]?.trim()
    const value = parts[valueIdx]?.trim()

    if (!passport || !destination || !value) continue
    // Skip self-referencing entries
    if (passport === destination) continue

    const { visaStatus, maxStayDays } = normalizeStatus(value)
    rows.push({
      passportCountry: passport,
      destinationCountry: destination,
      visaStatus,
      maxStayDays,
    })
  }

  return rows
}

export default defineTask({
  meta: {
    name: "import-visa-data",
    description: "Import visa requirements from the Passport Index Dataset",
  },
  async run() {
    console.log("Fetching Passport Index Dataset...")
    const response = await fetch(DATASET_URL)
    if (!response.ok) {
      throw new Error(`Failed to fetch dataset: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    const rows = parseCsv(text)
    console.log(`Parsed ${rows.length} visa requirement entries`)

    // Upsert in batches of 500
    const BATCH_SIZE = 500
    let upserted = 0

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      await db
        .insert(visaRequirements)
        .values(
          batch.map((r) => ({
            passportCountry: r.passportCountry,
            destinationCountry: r.destinationCountry,
            visaStatus: r.visaStatus,
            maxStayDays: r.maxStayDays,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [visaRequirements.passportCountry, visaRequirements.destinationCountry],
          set: {
            visaStatus: sql`excluded.visa_status`,
            maxStayDays: sql`excluded.max_stay_days`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
      upserted += batch.length
    }

    console.log(`Upserted ${upserted} visa requirement entries`)
    return { result: { imported: upserted } }
  },
})
```

- [ ] **Step 2: Enable experimental tasks in `nuxt.config.ts`**

Check if `experimental.tasks` is already enabled. If not, add to `nuxt.config.ts`:

```typescript
experimental: {
  tasks: true,
},
```

- [ ] **Step 3: Run the import**

Run:

```bash
npx nuxt run task import-visa-data
```

Expected: Output shows "Parsed ~39000 entries" and "Upserted ~39000 entries".

- [ ] **Step 4: Commit**

```bash
git add server/tasks/import-visa-data.ts nuxt.config.ts
git commit -m "feat: add visa dataset import task from Passport Index Dataset"
```

---

## Task 7: Passport API Routes

**Files:**

- Create: `server/api/user/passports/index.get.ts`
- Create: `server/api/user/passports/index.post.ts`
- Create: `server/api/user/passports/[id].patch.ts`
- Create: `server/api/user/passports/[id].delete.ts`

- [ ] **Step 1: Create GET `/api/user/passports`**

Create `server/api/user/passports/index.get.ts`:

```typescript
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { userPassports } from "../../../db/schema"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  return db.query.userPassports.findMany({
    where: eq(userPassports.userId, session.user.id),
    orderBy: (p, { desc }) => [desc(p.isDefault), desc(p.createdAt)],
  })
})
```

- [ ] **Step 2: Create POST `/api/user/passports`**

Create `server/api/user/passports/index.post.ts`:

```typescript
import { and, eq } from "drizzle-orm"
import { db } from "../../../db"
import { userPassports } from "../../../db/schema"
import { createPassportSchema } from "../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createPassportSchema.parse)

  // If this is the first passport or isDefault is true, ensure only one default
  const existing = await db.query.userPassports.findMany({
    where: eq(userPassports.userId, session.user.id),
  })

  const shouldBeDefault = body.isDefault || existing.length === 0

  if (shouldBeDefault && existing.length > 0) {
    await db
      .update(userPassports)
      .set({ isDefault: false })
      .where(eq(userPassports.userId, session.user.id))
  }

  const [passport] = await db
    .insert(userPassports)
    .values({
      userId: session.user.id,
      countryCode: body.countryCode,
      label: body.label ?? null,
      isDefault: shouldBeDefault,
    })
    .returning()

  return passport
})
```

- [ ] **Step 3: Create PATCH `/api/user/passports/[id]`**

Create `server/api/user/passports/[id].patch.ts`:

```typescript
import { and, eq } from "drizzle-orm"
import { db } from "../../../db"
import { userPassports } from "../../../db/schema"
import { uuidParamsSchema, updatePassportSchema } from "../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, updatePassportSchema.parse)

  // Verify ownership
  const passport = await db.query.userPassports.findFirst({
    where: and(eq(userPassports.id, id), eq(userPassports.userId, session.user.id)),
  })

  if (!passport) {
    throw createError({ statusCode: 404, message: "Passport not found" })
  }

  // If setting as default, unset all others first
  if (body.isDefault) {
    await db
      .update(userPassports)
      .set({ isDefault: false })
      .where(eq(userPassports.userId, session.user.id))
  }

  const [updated] = await db
    .update(userPassports)
    .set({
      ...(body.label !== undefined ? { label: body.label ?? null } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    })
    .where(eq(userPassports.id, id))
    .returning()

  return updated
})
```

- [ ] **Step 4: Create DELETE `/api/user/passports/[id]`**

Create `server/api/user/passports/[id].delete.ts`:

```typescript
import { and, eq } from "drizzle-orm"
import { db } from "../../../db"
import { userPassports } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const passport = await db.query.userPassports.findFirst({
    where: and(eq(userPassports.id, id), eq(userPassports.userId, session.user.id)),
  })

  if (!passport) {
    throw createError({ statusCode: 404, message: "Passport not found" })
  }

  await db.delete(userPassports).where(eq(userPassports.id, id))

  // If deleted passport was default, promote the next one
  if (passport.isDefault) {
    const next = await db.query.userPassports.findFirst({
      where: eq(userPassports.userId, session.user.id),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    })
    if (next) {
      await db.update(userPassports).set({ isDefault: true }).where(eq(userPassports.id, next.id))
    }
  }

  return { success: true }
})
```

- [ ] **Step 5: Commit**

```bash
git add server/api/user/passports/
git commit -m "feat: add passport CRUD API routes"
```

---

## Task 8: AeroDataBox Flight API Integration

**Files:**

- Create: `server/lib/flight-api.ts`

- [ ] **Step 1: Create the flight API wrapper**

Create `server/lib/flight-api.ts`:

```typescript
const AERODATABOX_HOST = "aerodatabox.p.rapidapi.com"

interface AeroDataBoxFlight {
  airline?: { name?: string }
  flight?: { number?: string; iataNumber?: string }
  departure?: {
    airport?: { iata?: string; name?: string }
    scheduledTime?: { local?: string; utc?: string }
    terminal?: string
    gate?: string
  }
  arrival?: {
    airport?: { iata?: string; name?: string }
    scheduledTime?: { local?: string; utc?: string }
    terminal?: string
    gate?: string
  }
  status?: string
}

export interface FlightLookupResult {
  airline: string | null
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: Date | null
  arrivalTime: Date | null
  terminal: string | null
  gate: string | null
  status: string
  rawApiResponse: Record<string, unknown>
}

/**
 * Look up a flight by number and date from AeroDataBox.
 * Returns null if the flight is not found or the API key is not configured.
 */
export async function lookupFlight(
  flightNumber: string,
  flightDate: string,
): Promise<FlightLookupResult | null> {
  const apiKey = process.env.AERODATABOX_API_KEY
  if (!apiKey) {
    console.warn("AERODATABOX_API_KEY not set — flight lookup skipped")
    return null
  }

  const encoded = encodeURIComponent(flightNumber)
  const url = `https://${AERODATABOX_HOST}/flights/number/${encoded}/${flightDate}`

  let data: AeroDataBoxFlight[]
  try {
    data = await $fetch<AeroDataBoxFlight[]>(url, {
      headers: {
        "x-rapidapi-host": AERODATABOX_HOST,
        "x-rapidapi-key": apiKey,
      },
    })
  } catch (error: unknown) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 404) return null
    console.error("AeroDataBox API error:", error)
    return null
  }

  // The API may return multiple legs; take the first one
  const flight = data[0]
  if (!flight) return null

  return {
    airline: flight.airline?.name ?? null,
    departureAirport: flight.departure?.airport?.iata ?? null,
    arrivalAirport: flight.arrival?.airport?.iata ?? null,
    departureTime: flight.departure?.scheduledTime?.utc
      ? new Date(flight.departure.scheduledTime.utc)
      : null,
    arrivalTime: flight.arrival?.scheduledTime?.utc
      ? new Date(flight.arrival.scheduledTime.utc)
      : null,
    terminal: flight.departure?.terminal ?? null,
    gate: flight.departure?.gate ?? null,
    status: flight.status ?? "scheduled",
    rawApiResponse: flight as unknown as Record<string, unknown>,
  }
}
```

- [ ] **Step 2: Add `AERODATABOX_API_KEY` to `.env.example`**

Add to `.env.example`:

```
# AeroDataBox API (via RapidAPI) — free tier: ~600 calls/month
AERODATABOX_API_KEY=
```

- [ ] **Step 3: Commit**

```bash
git add server/lib/flight-api.ts .env.example
git commit -m "feat: add AeroDataBox flight API integration"
```

---

## Task 9: Flight API Routes

**Files:**

- Create: `server/api/flights/index.get.ts`
- Create: `server/api/flights/index.post.ts`
- Create: `server/api/flights/[id].get.ts`
- Create: `server/api/flights/[id].patch.ts`
- Create: `server/api/flights/[id].delete.ts`
- Create: `server/api/trips/[id]/flights.get.ts`

- [ ] **Step 1: Create GET `/api/flights`**

Create `server/api/flights/index.get.ts`:

```typescript
import { eq, and } from "drizzle-orm"
import { db } from "../../db"
import { flights } from "../../db/schema"

const querySchema = z.object({
  tripId: z.string().uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  const conditions = [eq(flights.userId, session.user.id)]
  if (query.tripId) {
    conditions.push(eq(flights.tripId, query.tripId))
  }

  return db.query.flights.findMany({
    where: and(...conditions),
    with: { trip: { columns: { id: true, destination: true } } },
    orderBy: (f, { asc }) => [asc(f.flightDate)],
  })
})
```

- [ ] **Step 2: Create POST `/api/flights`**

Create `server/api/flights/index.post.ts`:

```typescript
import { db } from "../../db"
import { flights } from "../../db/schema"
import { createFlightSchema } from "../../utils/schemas"
import { lookupFlight } from "../../lib/flight-api"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createFlightSchema.parse)

  // Look up flight data from AeroDataBox
  const flightData = await lookupFlight(body.flightNumber, body.flightDate)

  const [flight] = await db
    .insert(flights)
    .values({
      userId: session.user.id,
      flightNumber: body.flightNumber,
      flightDate: body.flightDate,
      tripId: body.tripId ?? null,
      airline: flightData?.airline ?? null,
      departureAirport: flightData?.departureAirport ?? null,
      arrivalAirport: flightData?.arrivalAirport ?? null,
      departureTime: flightData?.departureTime ?? null,
      arrivalTime: flightData?.arrivalTime ?? null,
      terminal: flightData?.terminal ?? null,
      gate: flightData?.gate ?? null,
      status: flightData?.status ?? "scheduled",
      rawApiResponse: flightData?.rawApiResponse ?? null,
      apiLastFetchedAt: flightData ? new Date() : null,
    })
    .returning()

  return flight
})
```

- [ ] **Step 3: Create GET `/api/flights/[id]` with fresh-on-load**

Create `server/api/flights/[id].get.ts`:

```typescript
import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { flights } from "../../db/schema"
import { uuidParamsSchema } from "../../utils/schemas"
import { lookupFlight } from "../../lib/flight-api"

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

function shouldRefresh(flight: {
  apiLastFetchedAt: Date | null
  flightDate: string
  arrivalTime: Date | null
}): boolean {
  // Never fetched yet — refresh
  if (!flight.apiLastFetchedAt) return true

  // Flight in the past (>24h after arrival or flight date) — data is final
  const referenceTime = flight.arrivalTime ?? new Date(flight.flightDate + "T23:59:59Z")
  const oneDayAfter = new Date(referenceTime.getTime() + 24 * 60 * 60 * 1000)
  if (new Date() > oneDayAfter) return false

  // Refresh if last fetch is older than 2 hours
  return new Date().getTime() - flight.apiLastFetchedAt.getTime() > TWO_HOURS_MS
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const flight = await db.query.flights.findFirst({
    where: and(eq(flights.id, id), eq(flights.userId, session.user.id)),
    with: { trip: { columns: { id: true, destination: true } } },
  })

  if (!flight) {
    throw createError({ statusCode: 404, message: "Flight not found" })
  }

  // Fresh-on-load: refresh if stale
  if (shouldRefresh(flight)) {
    const freshData = await lookupFlight(flight.flightNumber, flight.flightDate)
    if (freshData) {
      const [updated] = await db
        .update(flights)
        .set({
          airline: freshData.airline,
          departureAirport: freshData.departureAirport,
          arrivalAirport: freshData.arrivalAirport,
          departureTime: freshData.departureTime,
          arrivalTime: freshData.arrivalTime,
          terminal: freshData.terminal,
          gate: freshData.gate,
          status: freshData.status,
          rawApiResponse: freshData.rawApiResponse,
          apiLastFetchedAt: new Date(),
        })
        .where(eq(flights.id, id))
        .returning()

      return { ...updated, trip: flight.trip }
    }
  }

  return flight
})
```

- [ ] **Step 4: Create PATCH `/api/flights/[id]`**

Create `server/api/flights/[id].patch.ts`:

```typescript
import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { flights } from "../../db/schema"
import { uuidParamsSchema, updateFlightSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, updateFlightSchema.parse)

  const flight = await db.query.flights.findFirst({
    where: and(eq(flights.id, id), eq(flights.userId, session.user.id)),
  })

  if (!flight) {
    throw createError({ statusCode: 404, message: "Flight not found" })
  }

  const [updated] = await db
    .update(flights)
    .set({ tripId: body.tripId ?? null })
    .where(eq(flights.id, id))
    .returning()

  return updated
})
```

- [ ] **Step 5: Create DELETE `/api/flights/[id]`**

Create `server/api/flights/[id].delete.ts`:

```typescript
import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { flights } from "../../db/schema"
import { uuidParamsSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const flight = await db.query.flights.findFirst({
    where: and(eq(flights.id, id), eq(flights.userId, session.user.id)),
  })

  if (!flight) {
    throw createError({ statusCode: 404, message: "Flight not found" })
  }

  await db.delete(flights).where(eq(flights.id, id))
  return { success: true }
})
```

- [ ] **Step 6: Create GET `/api/trips/[id]/flights`**

Create `server/api/trips/[id]/flights.get.ts`:

```typescript
import { and, eq } from "drizzle-orm"
import { db } from "../../../db"
import { flights, trips, tripMembers } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  // Verify trip access (owner or member)
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
  })

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  if (trip.userId !== session.user.id) {
    const membership = await db.query.tripMembers.findFirst({
      where: and(eq(tripMembers.tripId, id), eq(tripMembers.userId, session.user.id)),
    })
    if (!membership) {
      throw createError({ statusCode: 403, message: "Not authorized" })
    }
  }

  return db.query.flights.findMany({
    where: eq(flights.tripId, id),
    orderBy: (f, { asc }) => [asc(f.flightDate)],
  })
})
```

- [ ] **Step 7: Commit**

```bash
git add server/api/flights/ server/api/trips/\[id\]/flights.get.ts
git commit -m "feat: add flight CRUD API routes with fresh-on-load refresh"
```

---

## Task 10: Update Visa Check Route

**Files:**

- Modify: `server/api/visa/check.post.ts`

- [ ] **Step 1: Rewrite visa check to use `visa_requirements` table + multi-passport**

Replace the contents of `server/api/visa/check.post.ts` with:

```typescript
import { and, eq, inArray } from "drizzle-orm"
import { db } from "../../db"
import { visaRequirements, userPassports } from "../../db/schema"
import { visaCheckQuerySchema } from "../../utils/schemas"

const VISA_STATUS_PRIORITY: Record<string, number> = {
  "visa-free": 0,
  "visa-on-arrival": 1,
  evisa: 2,
  "visa-required": 3,
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { destination } = await getValidatedQuery(event, visaCheckQuerySchema.parse)

  // Get all user passports
  const passports = await db.query.userPassports.findMany({
    where: eq(userPassports.userId, session.user.id),
  })

  if (passports.length === 0) {
    throw createError({
      statusCode: 400,
      message: "No passports configured. Please add a passport in settings.",
    })
  }

  const countryCodes = passports.map((p) => p.countryCode)

  // Check if any passport is from the destination country
  const homePassport = passports.find((p) => p.countryCode === destination)
  if (homePassport) {
    return {
      visaStatus: "visa-free",
      maxStayDays: null,
      passportCountry: homePassport.countryCode,
      destinationCountry: destination,
      isHomeCountry: true,
    }
  }

  // Look up visa requirements for all passports
  const results = await db.query.visaRequirements.findMany({
    where: and(
      inArray(visaRequirements.passportCountry, countryCodes),
      eq(visaRequirements.destinationCountry, destination),
    ),
  })

  if (results.length === 0) {
    return {
      visaStatus: "unknown",
      maxStayDays: null,
      passportCountry: passports[0]!.countryCode,
      destinationCountry: destination,
      isHomeCountry: false,
    }
  }

  // Return the most favorable result
  const best = results.sort(
    (a, b) =>
      (VISA_STATUS_PRIORITY[a.visaStatus] ?? 99) - (VISA_STATUS_PRIORITY[b.visaStatus] ?? 99),
  )[0]!

  return {
    visaStatus: best.visaStatus,
    maxStayDays: best.maxStayDays,
    passportCountry: best.passportCountry,
    destinationCountry: best.destinationCountry,
    isHomeCountry: false,
  }
})
```

**Note:** This changes the endpoint from POST to GET semantics but keeps the file as `check.post.ts` for now. Alternatively rename to `check.get.ts` — the spec says GET but existing consumers use POST. Create a new `check.get.ts` and keep the old POST as a deprecated wrapper, or just switch to GET. Decision: **rename to `check.get.ts`** and delete the old POST file since the only consumer (`VisaChecker.vue`) will be updated in Task 13.

- [ ] **Step 2: Rename the file**

```bash
mv server/api/visa/check.post.ts server/api/visa/check.get.ts
```

- [ ] **Step 3: Commit**

```bash
git add server/api/visa/check.get.ts
git rm server/api/visa/check.post.ts
git commit -m "refactor: rewrite visa check to use local dataset + multi-passport support"
```

---

## Task 11: VisaBadge Component

**Files:**

- Create: `app/components/VisaBadge.vue`

- [ ] **Step 1: Create the component**

Create `app/components/VisaBadge.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{
  destinationCountry: string
}>()

const { data: visaResult } = await useFetch("/api/visa/check", {
  query: { destination: props.destinationCountry },
  immediate: !!props.destinationCountry,
})

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  "visa-free": {
    label: "Visa Free",
    color:
      "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950 dark:border-green-800",
    icon: "lucide:check-circle",
  },
  "visa-on-arrival": {
    label: "Visa on Arrival",
    color:
      "text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800",
    icon: "lucide:clock",
  },
  evisa: {
    label: "e-Visa",
    color:
      "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800",
    icon: "lucide:globe",
  },
  "visa-required": {
    label: "Visa Required",
    color:
      "text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-800",
    icon: "lucide:shield-alert",
  },
}

const config = computed(() => {
  if (!visaResult.value) return null
  return statusConfig[visaResult.value.visaStatus] ?? null
})
</script>

<template>
  <span
    v-if="config && visaResult"
    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
    :class="config.color"
  >
    <Icon :name="config.icon" class="h-3 w-3" />
    {{ config.label }}
    <span v-if="visaResult.maxStayDays" class="opacity-75"> ({{ visaResult.maxStayDays }}d) </span>
  </span>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/VisaBadge.vue
git commit -m "feat: add VisaBadge component for inline visa status display"
```

---

## Task 12: FlightCard Component

**Files:**

- Create: `app/components/FlightCard.vue`

- [ ] **Step 1: Create the component**

Create `app/components/FlightCard.vue`:

```vue
<script setup lang="ts">
import { countryByAlpha2 } from "../data/countries"
import { iataToCountry } from "../../server/utils/iata-country-map"

interface Flight {
  id: string
  flightNumber: string
  flightDate: string
  airline: string | null
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
  terminal: string | null
  gate: string | null
  status: string
  tripId: string | null
  trip?: { id: string; destination: string } | null
}

const props = defineProps<{
  flight: Flight
  trips?: { id: string; destination: string }[]
}>()

const emit = defineEmits<{
  linkTrip: [flightId: string, tripId: string | null]
  delete: [flightId: string]
}>()

const statusConfig: Record<string, { label: string; color: string }> = {
  scheduled: {
    label: "Scheduled",
    color: "bg-sand-100 text-sand-700 dark:bg-sand-800 dark:text-sand-300",
  },
  delayed: {
    label: "Delayed",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  },
  landed: {
    label: "Landed",
    color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  cancelled: {
    label: "Cancelled",
    color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
}

const statusBadge = computed(() => statusConfig[props.flight.status] ?? statusConfig.scheduled)

const arrivalCountry = computed(() => {
  if (!props.flight.arrivalAirport) return null
  return iataToCountry[props.flight.arrivalAirport] ?? null
})

function formatTime(isoStr: string | null): string {
  if (!isoStr) return "--:--"
  return new Date(isoStr).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

const showTripDropdown = ref(false)

function selectTrip(tripId: string | null) {
  emit("linkTrip", props.flight.id, tripId)
  showTripDropdown.value = false
}
</script>

<template>
  <div
    class="rounded-2xl border border-sand-200 bg-white p-5 transition hover:shadow-md dark:border-sand-700 dark:bg-sand-900"
  >
    <!-- Header: airline + flight number + status -->
    <div class="flex items-start justify-between">
      <div>
        <p class="text-sm text-sand-500 dark:text-sand-400">
          {{ flight.airline ?? "Unknown Airline" }}
        </p>
        <p class="font-display text-lg text-sand-900 dark:text-sand-100">
          {{ flight.flightNumber }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span class="rounded-full px-2.5 py-0.5 text-xs font-medium" :class="statusBadge.color">
          {{ statusBadge.label }}
        </span>
        <button
          class="rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-red-500 dark:hover:bg-sand-800"
          title="Delete flight"
          @click="emit('delete', flight.id)"
        >
          <Icon name="lucide:trash-2" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Route: departure → arrival -->
    <div class="mt-4 flex items-center gap-3">
      <div class="text-center">
        <p class="font-display text-xl text-sand-900 dark:text-sand-100">
          {{ flight.departureAirport ?? "???" }}
        </p>
        <p class="text-xs text-sand-500">{{ formatTime(flight.departureTime) }}</p>
      </div>
      <div class="flex flex-1 items-center">
        <div class="h-px flex-1 bg-sand-200 dark:bg-sand-700" />
        <Icon name="lucide:plane" class="mx-2 h-4 w-4 text-sand-400" />
        <div class="h-px flex-1 bg-sand-200 dark:bg-sand-700" />
      </div>
      <div class="text-center">
        <p class="font-display text-xl text-sand-900 dark:text-sand-100">
          {{ flight.arrivalAirport ?? "???" }}
        </p>
        <p class="text-xs text-sand-500">{{ formatTime(flight.arrivalTime) }}</p>
      </div>
    </div>

    <!-- Date + terminal/gate + visa -->
    <div class="mt-4 flex flex-wrap items-center gap-2 text-xs text-sand-500 dark:text-sand-400">
      <span>{{ formatDate(flight.flightDate) }}</span>
      <span v-if="flight.terminal">· Terminal {{ flight.terminal }}</span>
      <span v-if="flight.gate">· Gate {{ flight.gate }}</span>
      <VisaBadge v-if="arrivalCountry" :destination-country="arrivalCountry" />
    </div>

    <!-- Trip link -->
    <div class="mt-3 flex items-center gap-2">
      <template v-if="flight.trip">
        <NuxtLink
          :to="`/trips/${flight.trip.id}`"
          class="inline-flex items-center gap-1 rounded-full bg-terra-50 px-2.5 py-1 text-xs font-medium text-terra-700 transition hover:bg-terra-100 dark:bg-terra-900 dark:text-terra-300"
        >
          <Icon name="lucide:map-pin" class="h-3 w-3" />
          {{ flight.trip.destination }}
        </NuxtLink>
        <button class="text-xs text-sand-400 hover:text-sand-600" @click="selectTrip(null)">
          Unlink
        </button>
      </template>
      <template v-else-if="trips && trips.length > 0">
        <div class="relative">
          <button
            class="inline-flex items-center gap-1 rounded-full border border-dashed border-sand-300 px-2.5 py-1 text-xs text-sand-500 transition hover:border-sand-400 hover:text-sand-700 dark:border-sand-600"
            @click="showTripDropdown = !showTripDropdown"
          >
            <Icon name="lucide:link" class="h-3 w-3" />
            Link to trip
          </button>
          <div
            v-if="showTripDropdown"
            class="absolute left-0 top-full z-10 mt-1 w-48 rounded-xl border border-sand-200 bg-white py-1 shadow-lg dark:border-sand-700 dark:bg-sand-800"
          >
            <button
              v-for="trip in trips"
              :key="trip.id"
              class="block w-full px-3 py-2 text-left text-xs text-sand-700 hover:bg-sand-50 dark:text-sand-300 dark:hover:bg-sand-700"
              @click="selectTrip(trip.id)"
            >
              {{ trip.destination }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/FlightCard.vue
git commit -m "feat: add FlightCard component with visa badge and trip linking"
```

---

## Task 13: My Flights Page

**Files:**

- Create: `app/pages/flights.vue`

- [ ] **Step 1: Create the flights page**

Create `app/pages/flights.vue`:

```vue
<script setup lang="ts">
definePageMeta({ layout: "app" })
useSeoMeta({
  title: "My Flights",
  description: "Track your flight details, gates, and visa requirements.",
})

interface Flight {
  id: string
  flightNumber: string
  flightDate: string
  airline: string | null
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
  terminal: string | null
  gate: string | null
  status: string
  tripId: string | null
  trip?: { id: string; destination: string } | null
}

const { data: flights, refresh } = await useFetch<Flight[]>("/api/flights")
const { data: trips } = await useFetch<{ id: string; destination: string }[]>("/api/trips", {
  transform: (data: { id: string; destination: string }[]) =>
    data.map((t) => ({ id: t.id, destination: t.destination })),
})

// Add flight form
const newFlightNumber = ref("")
const newFlightDate = ref("")
const adding = ref(false)

async function addFlight() {
  if (!newFlightNumber.value || !newFlightDate.value) return
  adding.value = true
  try {
    await $fetch("/api/flights", {
      method: "POST",
      body: {
        flightNumber: newFlightNumber.value,
        flightDate: newFlightDate.value,
      },
    })
    newFlightNumber.value = ""
    newFlightDate.value = ""
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to add flight:", e)
  } finally {
    adding.value = false
  }
}

async function linkTrip(flightId: string, tripId: string | null) {
  await $fetch(`/api/flights/${flightId}`, {
    method: "PATCH",
    body: { tripId },
  })
  await refresh()
}

async function deleteFlight(flightId: string) {
  if (!confirm("Delete this flight?")) return
  await $fetch(`/api/flights/${flightId}`, { method: "DELETE" })
  await refresh()
}

const today = new Date().toISOString().split("T")[0]!

const upcomingFlights = computed(() => (flights.value ?? []).filter((f) => f.flightDate >= today))

const pastFlights = computed(() =>
  (flights.value ?? [])
    .filter((f) => f.flightDate < today)
    .sort((a, b) => b.flightDate.localeCompare(a.flightDate)),
)

const showPast = ref(false)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <h1 class="font-display text-2xl text-sand-900 dark:text-sand-100">My Flights</h1>

    <!-- Add flight form -->
    <form
      class="flex flex-col gap-3 rounded-2xl border border-sand-200 bg-white p-5 sm:flex-row sm:items-end dark:border-sand-700 dark:bg-sand-900"
      @submit.prevent="addFlight"
    >
      <div class="flex-1">
        <label class="mb-1 block text-xs font-medium text-sand-600 dark:text-sand-400">
          Flight number
        </label>
        <input
          v-model="newFlightNumber"
          type="text"
          placeholder="e.g. SQ638"
          class="w-full rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-400 focus:border-terra-400 focus:outline-none dark:border-sand-700 dark:bg-sand-800 dark:text-sand-100"
        />
      </div>
      <div class="flex-1">
        <label class="mb-1 block text-xs font-medium text-sand-600 dark:text-sand-400">
          Date
        </label>
        <input
          v-model="newFlightDate"
          type="date"
          class="w-full rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 focus:border-terra-400 focus:outline-none dark:border-sand-700 dark:bg-sand-800 dark:text-sand-100"
        />
      </div>
      <button
        type="submit"
        :disabled="adding || !newFlightNumber || !newFlightDate"
        class="rounded-xl bg-terra-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-terra-600 disabled:opacity-50"
      >
        {{ adding ? "Adding..." : "Add Flight" }}
      </button>
    </form>

    <!-- Upcoming flights -->
    <section v-if="upcomingFlights.length > 0">
      <h2 class="mb-3 text-sm font-semibold text-sand-600 dark:text-sand-400">
        Upcoming ({{ upcomingFlights.length }})
      </h2>
      <div class="space-y-3">
        <FlightCard
          v-for="flight in upcomingFlights"
          :key="flight.id"
          :flight="flight"
          :trips="trips ?? []"
          @link-trip="linkTrip"
          @delete="deleteFlight"
        />
      </div>
    </section>

    <!-- Empty state -->
    <div
      v-if="!flights?.length"
      class="rounded-2xl border border-dashed border-sand-300 p-12 text-center dark:border-sand-700"
    >
      <Icon name="lucide:plane" class="mx-auto h-10 w-10 text-sand-300 dark:text-sand-600" />
      <p class="mt-3 text-sm text-sand-500 dark:text-sand-400">
        No flights yet. Add a flight above to get started.
      </p>
    </div>

    <!-- Past flights (collapsed) -->
    <section v-if="pastFlights.length > 0">
      <button
        class="flex items-center gap-1 text-sm font-semibold text-sand-500 transition hover:text-sand-700 dark:text-sand-400"
        @click="showPast = !showPast"
      >
        <Icon :name="showPast ? 'lucide:chevron-down' : 'lucide:chevron-right'" class="h-4 w-4" />
        Past Flights ({{ pastFlights.length }})
      </button>
      <div v-if="showPast" class="mt-3 space-y-3">
        <FlightCard
          v-for="flight in pastFlights"
          :key="flight.id"
          :flight="flight"
          :trips="trips ?? []"
          @link-trip="linkTrip"
          @delete="deleteFlight"
        />
      </div>
    </section>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/pages/flights.vue
git commit -m "feat: add My Flights page with add/link/delete functionality"
```

---

## Task 14: PassportManager Component

**Files:**

- Create: `app/components/PassportManager.vue`

- [ ] **Step 1: Create the component**

Create `app/components/PassportManager.vue`:

```vue
<script setup lang="ts">
import { countries } from "../data/countries"

interface Passport {
  id: string
  countryCode: string
  label: string | null
  isDefault: boolean
}

const { data: passports, refresh } = await useFetch<Passport[]>("/api/user/passports")

const newCountryCode = ref("")
const newLabel = ref("")
const adding = ref(false)

const countryOptions = computed(() =>
  countries
    .map((c) => ({ value: c.alpha2, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label)),
)

function countryName(code: string): string {
  return countries.find((c) => c.alpha2 === code)?.name ?? code
}

async function addPassport() {
  if (!newCountryCode.value) return
  adding.value = true
  try {
    await $fetch("/api/user/passports", {
      method: "POST",
      body: {
        countryCode: newCountryCode.value,
        label: newLabel.value || null,
      },
    })
    newCountryCode.value = ""
    newLabel.value = ""
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to add passport:", e)
  } finally {
    adding.value = false
  }
}

async function setDefault(id: string) {
  await $fetch(`/api/user/passports/${id}`, {
    method: "PATCH",
    body: { isDefault: true },
  })
  await refresh()
}

async function removePassport(id: string) {
  if (!confirm("Remove this passport?")) return
  await $fetch(`/api/user/passports/${id}`, { method: "DELETE" })
  await refresh()
}
</script>

<template>
  <div class="space-y-4">
    <!-- Existing passports -->
    <div v-if="passports?.length" class="space-y-2">
      <div
        v-for="passport in passports"
        :key="passport.id"
        class="flex items-center gap-3 rounded-xl border border-sand-200 px-4 py-3 dark:border-sand-700"
      >
        <span class="text-lg">{{ countryName(passport.countryCode) }}</span>
        <span class="text-xs text-sand-500">{{ passport.countryCode }}</span>
        <span v-if="passport.label" class="text-xs text-sand-400">({{ passport.label }})</span>
        <button
          v-if="!passport.isDefault"
          class="ml-auto text-xs text-sand-400 hover:text-terra-500"
          title="Set as default"
          @click="setDefault(passport.id)"
        >
          <Icon name="lucide:star" class="h-4 w-4" />
        </button>
        <Icon
          v-else
          name="lucide:star"
          class="ml-auto h-4 w-4 text-terra-500"
          title="Default passport"
        />
        <button
          class="text-sand-400 hover:text-red-500"
          title="Remove"
          @click="removePassport(passport.id)"
        >
          <Icon name="lucide:trash-2" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Add passport form -->
    <div class="flex flex-col gap-2 sm:flex-row">
      <select
        v-model="newCountryCode"
        class="flex-1 rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 focus:border-terra-400 focus:outline-none dark:border-sand-700 dark:bg-sand-800 dark:text-sand-100"
      >
        <option value="" disabled>Select country</option>
        <option v-for="opt in countryOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <input
        v-model="newLabel"
        type="text"
        placeholder="Label (optional)"
        class="rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-400 focus:border-terra-400 focus:outline-none dark:border-sand-700 dark:bg-sand-800 dark:text-sand-100 sm:w-40"
      />
      <button
        :disabled="!newCountryCode || adding"
        class="rounded-xl bg-terra-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-terra-600 disabled:opacity-50"
        @click="addPassport"
      >
        Add
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/PassportManager.vue
git commit -m "feat: add PassportManager component for multi-passport support"
```

---

## Task 15: Integrate Into Settings, Navigation, and Trip Detail

**Files:**

- Modify: `app/pages/settings.vue`
- Modify: `app/layouts/app.vue`
- Modify: `app/pages/trips/[id].vue`
- Modify: `app/components/VisaChecker.vue`

- [ ] **Step 1: Add PassportManager to settings page**

In `app/pages/settings.vue`, replace the existing "Passport Nationality" section (the `<div class="rounded-2xl border border-sand-200 bg-white p-6">` block containing `NationalitySelector`) with:

```vue
    <!-- Passports -->
    <div class="rounded-2xl border border-sand-200 bg-white p-6 dark:border-sand-700 dark:bg-sand-900">
      <h2 class="text-sm font-semibold text-sand-900 dark:text-sand-100">Passports</h2>
      <p class="mt-1 text-xs text-sand-500 dark:text-sand-400">
        Used for visa requirement checks. Add multiple if you hold dual citizenship.
      </p>
      <div class="mt-4">
        <PassportManager />
      </div>
    </div>
```

Also remove the `useNationality()` import/usage and the `nationalityInitialized` watcher from the `<script setup>` section, since passports are now managed by `PassportManager`.

- [ ] **Step 2: Add Flights nav link**

In `app/layouts/app.vue`, add a Flights nav link after the Explore link. Find the Explore NuxtLink and add this immediately after it:

```vue
<NuxtLink
  to="/flights"
  class="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-sand-500 transition hover:bg-sand-100 hover:text-sand-700 dark:text-sand-400 dark:hover:bg-sand-800 dark:hover:text-sand-200"
  active-class="bg-sand-100 text-sand-900 dark:bg-sand-800 dark:text-sand-100"
>
            <Icon name="lucide:plane" class="h-4 w-4" />
            <span class="hidden sm:inline">Flights</span>
          </NuxtLink>
```

- [ ] **Step 3: Add Flights tab to trip detail page**

In `app/pages/trips/[id].vue`:

1. Add `"flights"` to the `TabValue` type union and to the `validTabs` array.

2. Add a data fetch for trip flights:

```typescript
const { data: tripFlights, refresh: refreshFlights } = await useFetch<Flight[]>(
  `/api/trips/${tripId}/flights`,
)
```

3. Add the Flights tab content in the template where other tab panels are rendered (alongside overview, itinerary, notes, etc.). Find the pattern and add:

```vue
        <!-- Flights tab -->
        <div v-if="activeTab === 'flights'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="font-display text-lg text-sand-900 dark:text-sand-100">Flights</h2>
            <NuxtLink
              to="/flights"
              class="text-xs text-terra-500 hover:text-terra-600"
            >
              Manage in My Flights
            </NuxtLink>
          </div>
          <div v-if="tripFlights?.length" class="space-y-3">
            <FlightCard
              v-for="flight in tripFlights"
              :key="flight.id"
              :flight="flight"
            />
          </div>
          <div
            v-else
            class="rounded-2xl border border-dashed border-sand-300 p-8 text-center dark:border-sand-700"
          >
            <p class="text-sm text-sand-500">
              No flights linked to this trip.
              <NuxtLink to="/flights" class="text-terra-500 hover:underline">
                Add flights
              </NuxtLink>
              and link them here.
            </p>
          </div>
        </div>
```

4. Add a Flights tab button in the tab bar. Find where the other tab buttons are rendered and add:

```vue
<button class="..." :class="activeTab === 'flights' ? '...' : '...'" @click="activeTab = 'flights'">
              <Icon name="lucide:plane" class="h-4 w-4" />
              Flights
            </button>
```

Use the same class pattern as the existing tab buttons.

- [ ] **Step 4: Update VisaChecker.vue to use GET endpoint**

In `app/components/VisaChecker.vue`, update the `checkVisa` function to use the new GET endpoint. Change:

```typescript
const result = await $fetch("/api/visa/check", {
  method: "POST",
  body: {
    destinationCountry: props.destination.alpha2,
    destinationCountryName: props.destination.name,
    passportCountry: nationality.value,
    passportCountryName: passportName,
  },
})
```

To:

```typescript
const result = await $fetch("/api/visa/check", {
  query: { destination: props.destination.alpha2 },
})
```

The new endpoint handles multi-passport lookup automatically, so the component no longer needs to send passport info. The nationality selector can remain for display purposes, or be removed if the passport is now managed in settings.

- [ ] **Step 5: Commit**

```bash
git add app/pages/settings.vue app/layouts/app.vue app/pages/trips/\[id\].vue app/components/VisaChecker.vue
git commit -m "feat: integrate flights and passports into settings, nav, trip detail, and visa checker"
```

---

## Task 16: Manual Smoke Test

- [ ] **Step 1: Start the dev server**

Run:

```bash
npm run dev
```

- [ ] **Step 2: Test passport management**

1. Navigate to `/settings`
2. Add a passport (e.g. "MY" for Malaysia)
3. Add a second passport (e.g. "US")
4. Set one as default
5. Delete one

- [ ] **Step 3: Test flight CRUD**

1. Navigate to `/flights`
2. Add a flight (e.g. "SQ638" on a future date) — if `AERODATABOX_API_KEY` is not set, the flight is created with minimal data
3. Verify the flight card renders with available info
4. Link the flight to an existing trip
5. Verify the visa badge shows on the flight card
6. Delete the flight

- [ ] **Step 4: Test trip detail flights tab**

1. Navigate to a trip with a linked flight
2. Click the "Flights" tab
3. Verify the linked flight card appears

- [ ] **Step 5: Test visa check on explore page**

1. Navigate to explore and trigger a visa check for a country
2. Verify it uses the new GET-based endpoint with multi-passport logic

- [ ] **Step 6: Commit any fixes**

If any issues found, fix and commit:

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
