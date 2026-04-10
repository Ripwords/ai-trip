# Scratch Map & Visa Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive world scratch map where users track countries they've visited, and an AI-powered visa checker that shows visa requirements based on the user's passport nationality.

**Architecture:** Two features on a shared `/explore` page. The scratch map renders an SVG world map using TopoJSON country boundaries — countries are colored based on visited status. Clicking a country opens a detail panel where users can mark it as visited or check visa requirements. The visa checker uses Gemini (with web search) to fetch and cache visa information for the user's passport + destination combo.

**Tech Stack:** TopoJSON (`world-atlas` + `topojson-client`) for map data, `d3-geo` for SVG projection, Drizzle ORM for new tables, Gemini AI with web search for visa info, Zod for validation.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `server/db/schema/visited-countries.ts` | DB table: tracks which countries a user has visited |
| `server/db/schema/user-profiles.ts` | DB table: stores user nationality/passport country |
| `server/db/schema/visa-cache.ts` | DB table: caches AI visa requirement lookups |
| `server/api/visited-countries/index.get.ts` | List all visited countries for current user |
| `server/api/visited-countries/index.post.ts` | Mark a country as visited |
| `server/api/visited-countries/[countryCode].delete.ts` | Unmark a visited country |
| `server/api/user/profile.get.ts` | Get user profile (nationality) |
| `server/api/user/profile.put.ts` | Update user profile (set nationality) |
| `server/api/visa/check.post.ts` | AI-powered visa requirement check |
| `server/lib/visa-checker.ts` | Visa check logic: AI call + cache layer |
| `app/pages/explore.vue` | Main page: scratch map + side panels |
| `app/components/ScratchMap.vue` | SVG world map with country interaction |
| `app/components/CountryDetailPanel.vue` | Slide-over panel: country info, visited toggle, visa check |
| `app/components/VisaChecker.vue` | Visa requirement display card |
| `app/components/NationalitySelector.vue` | Dropdown to set passport nationality |
| `app/data/countries.ts` | Static country list: ISO alpha-3 code, name, region |

### Modified Files

| File | Change |
|------|--------|
| `server/db/schema/index.ts` | Export new schema tables |
| `app/layouts/app.vue` | Add "Explore" nav link |
| `app/middleware/auth.global.ts` | Protect `/explore` route |
| `package.json` | Add `world-atlas`, `topojson-client`, `d3-geo` deps |

---

## Phase 1: Scratch Map

### Task 1: Install Dependencies

- [ ] **Step 1: Install map packages**

```bash
cd /Users/jiajingteoh/Documents/ai-trip
bun add topojson-client d3-geo
bun add -d @types/topojson-client @types/d3-geo
```

Note: `world-atlas` TopoJSON data will be fetched at build time from the CDN (`cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json`) and cached as a static asset, avoiding a direct npm dependency. This keeps the bundle lean and avoids SSR issues with the `world-atlas` package.

- [ ] **Step 2: Download the world-atlas TopoJSON file**

```bash
mkdir -p /Users/jiajingteoh/Documents/ai-trip/app/data
curl -o /Users/jiajingteoh/Documents/ai-trip/app/data/countries-110m.json \
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
```

This file contains TopoJSON at 110m resolution (~150KB). Country IDs use ISO 3166-1 numeric codes.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb app/data/countries-110m.json
git commit -m "chore: add topojson and d3-geo dependencies for scratch map"
```

---

### Task 2: Country Data Module

The TopoJSON file uses ISO 3166-1 **numeric** codes (e.g., "840" for USA). We need a mapping to human-readable names and ISO alpha-2 codes (used in the DB and visa checker).

- [ ] **Step 1: Create country data file**

Create `app/data/countries.ts`:

```ts
// ISO 3166-1 numeric → { alpha2, name, region }
// This is a curated subset covering all sovereign states (~195 countries)
export interface CountryInfo {
  numeric: string;
  alpha2: string;
  name: string;
  region: string;
}

export const countries: CountryInfo[] = [
  { numeric: "004", alpha2: "AF", name: "Afghanistan", region: "Asia" },
  { numeric: "008", alpha2: "AL", name: "Albania", region: "Europe" },
  { numeric: "012", alpha2: "DZ", name: "Algeria", region: "Africa" },
  { numeric: "020", alpha2: "AD", name: "Andorra", region: "Europe" },
  { numeric: "024", alpha2: "AO", name: "Angola", region: "Africa" },
  { numeric: "028", alpha2: "AG", name: "Antigua and Barbuda", region: "Americas" },
  { numeric: "032", alpha2: "AR", name: "Argentina", region: "Americas" },
  { numeric: "051", alpha2: "AM", name: "Armenia", region: "Asia" },
  { numeric: "036", alpha2: "AU", name: "Australia", region: "Oceania" },
  { numeric: "040", alpha2: "AT", name: "Austria", region: "Europe" },
  { numeric: "031", alpha2: "AZ", name: "Azerbaijan", region: "Asia" },
  { numeric: "044", alpha2: "BS", name: "Bahamas", region: "Americas" },
  { numeric: "048", alpha2: "BH", name: "Bahrain", region: "Asia" },
  { numeric: "050", alpha2: "BD", name: "Bangladesh", region: "Asia" },
  { numeric: "052", alpha2: "BB", name: "Barbados", region: "Americas" },
  { numeric: "112", alpha2: "BY", name: "Belarus", region: "Europe" },
  { numeric: "056", alpha2: "BE", name: "Belgium", region: "Europe" },
  { numeric: "084", alpha2: "BZ", name: "Belize", region: "Americas" },
  { numeric: "204", alpha2: "BJ", name: "Benin", region: "Africa" },
  { numeric: "064", alpha2: "BT", name: "Bhutan", region: "Asia" },
  { numeric: "068", alpha2: "BO", name: "Bolivia", region: "Americas" },
  { numeric: "070", alpha2: "BA", name: "Bosnia and Herzegovina", region: "Europe" },
  { numeric: "072", alpha2: "BW", name: "Botswana", region: "Africa" },
  { numeric: "076", alpha2: "BR", name: "Brazil", region: "Americas" },
  { numeric: "096", alpha2: "BN", name: "Brunei", region: "Asia" },
  { numeric: "100", alpha2: "BG", name: "Bulgaria", region: "Europe" },
  { numeric: "854", alpha2: "BF", name: "Burkina Faso", region: "Africa" },
  { numeric: "108", alpha2: "BI", name: "Burundi", region: "Africa" },
  { numeric: "132", alpha2: "CV", name: "Cabo Verde", region: "Africa" },
  { numeric: "116", alpha2: "KH", name: "Cambodia", region: "Asia" },
  { numeric: "120", alpha2: "CM", name: "Cameroon", region: "Africa" },
  { numeric: "124", alpha2: "CA", name: "Canada", region: "Americas" },
  { numeric: "140", alpha2: "CF", name: "Central African Republic", region: "Africa" },
  { numeric: "148", alpha2: "TD", name: "Chad", region: "Africa" },
  { numeric: "152", alpha2: "CL", name: "Chile", region: "Americas" },
  { numeric: "156", alpha2: "CN", name: "China", region: "Asia" },
  { numeric: "170", alpha2: "CO", name: "Colombia", region: "Americas" },
  { numeric: "174", alpha2: "KM", name: "Comoros", region: "Africa" },
  { numeric: "178", alpha2: "CG", name: "Congo", region: "Africa" },
  { numeric: "180", alpha2: "CD", name: "DR Congo", region: "Africa" },
  { numeric: "188", alpha2: "CR", name: "Costa Rica", region: "Americas" },
  { numeric: "384", alpha2: "CI", name: "Cote d'Ivoire", region: "Africa" },
  { numeric: "191", alpha2: "HR", name: "Croatia", region: "Europe" },
  { numeric: "192", alpha2: "CU", name: "Cuba", region: "Americas" },
  { numeric: "196", alpha2: "CY", name: "Cyprus", region: "Europe" },
  { numeric: "203", alpha2: "CZ", name: "Czechia", region: "Europe" },
  { numeric: "208", alpha2: "DK", name: "Denmark", region: "Europe" },
  { numeric: "262", alpha2: "DJ", name: "Djibouti", region: "Africa" },
  { numeric: "212", alpha2: "DM", name: "Dominica", region: "Americas" },
  { numeric: "214", alpha2: "DO", name: "Dominican Republic", region: "Americas" },
  { numeric: "218", alpha2: "EC", name: "Ecuador", region: "Americas" },
  { numeric: "818", alpha2: "EG", name: "Egypt", region: "Africa" },
  { numeric: "222", alpha2: "SV", name: "El Salvador", region: "Americas" },
  { numeric: "226", alpha2: "GQ", name: "Equatorial Guinea", region: "Africa" },
  { numeric: "232", alpha2: "ER", name: "Eritrea", region: "Africa" },
  { numeric: "233", alpha2: "EE", name: "Estonia", region: "Europe" },
  { numeric: "748", alpha2: "SZ", name: "Eswatini", region: "Africa" },
  { numeric: "231", alpha2: "ET", name: "Ethiopia", region: "Africa" },
  { numeric: "242", alpha2: "FJ", name: "Fiji", region: "Oceania" },
  { numeric: "246", alpha2: "FI", name: "Finland", region: "Europe" },
  { numeric: "250", alpha2: "FR", name: "France", region: "Europe" },
  { numeric: "266", alpha2: "GA", name: "Gabon", region: "Africa" },
  { numeric: "270", alpha2: "GM", name: "Gambia", region: "Africa" },
  { numeric: "268", alpha2: "GE", name: "Georgia", region: "Asia" },
  { numeric: "276", alpha2: "DE", name: "Germany", region: "Europe" },
  { numeric: "288", alpha2: "GH", name: "Ghana", region: "Africa" },
  { numeric: "300", alpha2: "GR", name: "Greece", region: "Europe" },
  { numeric: "308", alpha2: "GD", name: "Grenada", region: "Americas" },
  { numeric: "320", alpha2: "GT", name: "Guatemala", region: "Americas" },
  { numeric: "324", alpha2: "GN", name: "Guinea", region: "Africa" },
  { numeric: "624", alpha2: "GW", name: "Guinea-Bissau", region: "Africa" },
  { numeric: "328", alpha2: "GY", name: "Guyana", region: "Americas" },
  { numeric: "332", alpha2: "HT", name: "Haiti", region: "Americas" },
  { numeric: "340", alpha2: "HN", name: "Honduras", region: "Americas" },
  { numeric: "348", alpha2: "HU", name: "Hungary", region: "Europe" },
  { numeric: "352", alpha2: "IS", name: "Iceland", region: "Europe" },
  { numeric: "356", alpha2: "IN", name: "India", region: "Asia" },
  { numeric: "360", alpha2: "ID", name: "Indonesia", region: "Asia" },
  { numeric: "364", alpha2: "IR", name: "Iran", region: "Asia" },
  { numeric: "368", alpha2: "IQ", name: "Iraq", region: "Asia" },
  { numeric: "372", alpha2: "IE", name: "Ireland", region: "Europe" },
  { numeric: "376", alpha2: "IL", name: "Israel", region: "Asia" },
  { numeric: "380", alpha2: "IT", name: "Italy", region: "Europe" },
  { numeric: "388", alpha2: "JM", name: "Jamaica", region: "Americas" },
  { numeric: "392", alpha2: "JP", name: "Japan", region: "Asia" },
  { numeric: "400", alpha2: "JO", name: "Jordan", region: "Asia" },
  { numeric: "398", alpha2: "KZ", name: "Kazakhstan", region: "Asia" },
  { numeric: "404", alpha2: "KE", name: "Kenya", region: "Africa" },
  { numeric: "296", alpha2: "KI", name: "Kiribati", region: "Oceania" },
  { numeric: "408", alpha2: "KP", name: "North Korea", region: "Asia" },
  { numeric: "410", alpha2: "KR", name: "South Korea", region: "Asia" },
  { numeric: "414", alpha2: "KW", name: "Kuwait", region: "Asia" },
  { numeric: "417", alpha2: "KG", name: "Kyrgyzstan", region: "Asia" },
  { numeric: "418", alpha2: "LA", name: "Laos", region: "Asia" },
  { numeric: "428", alpha2: "LV", name: "Latvia", region: "Europe" },
  { numeric: "422", alpha2: "LB", name: "Lebanon", region: "Asia" },
  { numeric: "426", alpha2: "LS", name: "Lesotho", region: "Africa" },
  { numeric: "430", alpha2: "LR", name: "Liberia", region: "Africa" },
  { numeric: "434", alpha2: "LY", name: "Libya", region: "Africa" },
  { numeric: "438", alpha2: "LI", name: "Liechtenstein", region: "Europe" },
  { numeric: "440", alpha2: "LT", name: "Lithuania", region: "Europe" },
  { numeric: "442", alpha2: "LU", name: "Luxembourg", region: "Europe" },
  { numeric: "450", alpha2: "MG", name: "Madagascar", region: "Africa" },
  { numeric: "454", alpha2: "MW", name: "Malawi", region: "Africa" },
  { numeric: "458", alpha2: "MY", name: "Malaysia", region: "Asia" },
  { numeric: "462", alpha2: "MV", name: "Maldives", region: "Asia" },
  { numeric: "466", alpha2: "ML", name: "Mali", region: "Africa" },
  { numeric: "470", alpha2: "MT", name: "Malta", region: "Europe" },
  { numeric: "584", alpha2: "MH", name: "Marshall Islands", region: "Oceania" },
  { numeric: "478", alpha2: "MR", name: "Mauritania", region: "Africa" },
  { numeric: "480", alpha2: "MU", name: "Mauritius", region: "Africa" },
  { numeric: "484", alpha2: "MX", name: "Mexico", region: "Americas" },
  { numeric: "583", alpha2: "FM", name: "Micronesia", region: "Oceania" },
  { numeric: "498", alpha2: "MD", name: "Moldova", region: "Europe" },
  { numeric: "492", alpha2: "MC", name: "Monaco", region: "Europe" },
  { numeric: "496", alpha2: "MN", name: "Mongolia", region: "Asia" },
  { numeric: "499", alpha2: "ME", name: "Montenegro", region: "Europe" },
  { numeric: "504", alpha2: "MA", name: "Morocco", region: "Africa" },
  { numeric: "508", alpha2: "MZ", name: "Mozambique", region: "Africa" },
  { numeric: "104", alpha2: "MM", name: "Myanmar", region: "Asia" },
  { numeric: "516", alpha2: "NA", name: "Namibia", region: "Africa" },
  { numeric: "520", alpha2: "NR", name: "Nauru", region: "Oceania" },
  { numeric: "524", alpha2: "NP", name: "Nepal", region: "Asia" },
  { numeric: "528", alpha2: "NL", name: "Netherlands", region: "Europe" },
  { numeric: "554", alpha2: "NZ", name: "New Zealand", region: "Oceania" },
  { numeric: "558", alpha2: "NI", name: "Nicaragua", region: "Americas" },
  { numeric: "562", alpha2: "NE", name: "Niger", region: "Africa" },
  { numeric: "566", alpha2: "NG", name: "Nigeria", region: "Africa" },
  { numeric: "807", alpha2: "MK", name: "North Macedonia", region: "Europe" },
  { numeric: "578", alpha2: "NO", name: "Norway", region: "Europe" },
  { numeric: "512", alpha2: "OM", name: "Oman", region: "Asia" },
  { numeric: "586", alpha2: "PK", name: "Pakistan", region: "Asia" },
  { numeric: "585", alpha2: "PW", name: "Palau", region: "Oceania" },
  { numeric: "591", alpha2: "PA", name: "Panama", region: "Americas" },
  { numeric: "598", alpha2: "PG", name: "Papua New Guinea", region: "Oceania" },
  { numeric: "600", alpha2: "PY", name: "Paraguay", region: "Americas" },
  { numeric: "604", alpha2: "PE", name: "Peru", region: "Americas" },
  { numeric: "608", alpha2: "PH", name: "Philippines", region: "Asia" },
  { numeric: "616", alpha2: "PL", name: "Poland", region: "Europe" },
  { numeric: "620", alpha2: "PT", name: "Portugal", region: "Europe" },
  { numeric: "634", alpha2: "QA", name: "Qatar", region: "Asia" },
  { numeric: "642", alpha2: "RO", name: "Romania", region: "Europe" },
  { numeric: "643", alpha2: "RU", name: "Russia", region: "Europe" },
  { numeric: "646", alpha2: "RW", name: "Rwanda", region: "Africa" },
  { numeric: "659", alpha2: "KN", name: "Saint Kitts and Nevis", region: "Americas" },
  { numeric: "662", alpha2: "LC", name: "Saint Lucia", region: "Americas" },
  { numeric: "670", alpha2: "VC", name: "Saint Vincent and the Grenadines", region: "Americas" },
  { numeric: "882", alpha2: "WS", name: "Samoa", region: "Oceania" },
  { numeric: "674", alpha2: "SM", name: "San Marino", region: "Europe" },
  { numeric: "678", alpha2: "ST", name: "Sao Tome and Principe", region: "Africa" },
  { numeric: "682", alpha2: "SA", name: "Saudi Arabia", region: "Asia" },
  { numeric: "686", alpha2: "SN", name: "Senegal", region: "Africa" },
  { numeric: "688", alpha2: "RS", name: "Serbia", region: "Europe" },
  { numeric: "690", alpha2: "SC", name: "Seychelles", region: "Africa" },
  { numeric: "694", alpha2: "SL", name: "Sierra Leone", region: "Africa" },
  { numeric: "702", alpha2: "SG", name: "Singapore", region: "Asia" },
  { numeric: "703", alpha2: "SK", name: "Slovakia", region: "Europe" },
  { numeric: "705", alpha2: "SI", name: "Slovenia", region: "Europe" },
  { numeric: "090", alpha2: "SB", name: "Solomon Islands", region: "Oceania" },
  { numeric: "706", alpha2: "SO", name: "Somalia", region: "Africa" },
  { numeric: "710", alpha2: "ZA", name: "South Africa", region: "Africa" },
  { numeric: "728", alpha2: "SS", name: "South Sudan", region: "Africa" },
  { numeric: "724", alpha2: "ES", name: "Spain", region: "Europe" },
  { numeric: "144", alpha2: "LK", name: "Sri Lanka", region: "Asia" },
  { numeric: "729", alpha2: "SD", name: "Sudan", region: "Africa" },
  { numeric: "740", alpha2: "SR", name: "Suriname", region: "Americas" },
  { numeric: "752", alpha2: "SE", name: "Sweden", region: "Europe" },
  { numeric: "756", alpha2: "CH", name: "Switzerland", region: "Europe" },
  { numeric: "760", alpha2: "SY", name: "Syria", region: "Asia" },
  { numeric: "762", alpha2: "TJ", name: "Tajikistan", region: "Asia" },
  { numeric: "834", alpha2: "TZ", name: "Tanzania", region: "Africa" },
  { numeric: "764", alpha2: "TH", name: "Thailand", region: "Asia" },
  { numeric: "626", alpha2: "TL", name: "Timor-Leste", region: "Asia" },
  { numeric: "768", alpha2: "TG", name: "Togo", region: "Africa" },
  { numeric: "776", alpha2: "TO", name: "Tonga", region: "Oceania" },
  { numeric: "780", alpha2: "TT", name: "Trinidad and Tobago", region: "Americas" },
  { numeric: "788", alpha2: "TN", name: "Tunisia", region: "Africa" },
  { numeric: "792", alpha2: "TR", name: "Turkey", region: "Asia" },
  { numeric: "795", alpha2: "TM", name: "Turkmenistan", region: "Asia" },
  { numeric: "798", alpha2: "TV", name: "Tuvalu", region: "Oceania" },
  { numeric: "800", alpha2: "UG", name: "Uganda", region: "Africa" },
  { numeric: "804", alpha2: "UA", name: "Ukraine", region: "Europe" },
  { numeric: "784", alpha2: "AE", name: "United Arab Emirates", region: "Asia" },
  { numeric: "826", alpha2: "GB", name: "United Kingdom", region: "Europe" },
  { numeric: "840", alpha2: "US", name: "United States", region: "Americas" },
  { numeric: "858", alpha2: "UY", name: "Uruguay", region: "Americas" },
  { numeric: "860", alpha2: "UZ", name: "Uzbekistan", region: "Asia" },
  { numeric: "548", alpha2: "VU", name: "Vanuatu", region: "Oceania" },
  { numeric: "336", alpha2: "VA", name: "Vatican City", region: "Europe" },
  { numeric: "862", alpha2: "VE", name: "Venezuela", region: "Americas" },
  { numeric: "704", alpha2: "VN", name: "Vietnam", region: "Asia" },
  { numeric: "887", alpha2: "YE", name: "Yemen", region: "Asia" },
  { numeric: "894", alpha2: "ZM", name: "Zambia", region: "Africa" },
  { numeric: "716", alpha2: "ZW", name: "Zimbabwe", region: "Africa" },
];

// Lookup maps for fast access
export const countryByNumeric = new Map(countries.map((c) => [c.numeric, c]));
export const countryByAlpha2 = new Map(countries.map((c) => [c.alpha2, c]));

export const TOTAL_COUNTRIES = countries.length;

export const regions = [...new Set(countries.map((c) => c.region))].sort();
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd /Users/jiajingteoh/Documents/ai-trip && npx tsx --eval "import { countries, TOTAL_COUNTRIES } from './app/data/countries'; console.log('Countries:', TOTAL_COUNTRIES)"
```

Expected: `Countries: 195` (approximately)

- [ ] **Step 3: Commit**

```bash
git add app/data/countries.ts
git commit -m "feat: add country data module with ISO code mappings"
```

---

### Task 3: Database Schema — Visited Countries

- [ ] **Step 1: Create the visited-countries schema**

Create `server/db/schema/visited-countries.ts`:

```ts
import { pgTable, text, timestamp, uuid, date, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./auth-schema";

export const visitedCountries = pgTable(
  "visited_countries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    countryCode: text("country_code").notNull(), // ISO 3166-1 alpha-2
    countryName: text("country_name").notNull(),
    visitedAt: date("visited_at"), // optional: when they visited
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_visited_countries_user_country").on(table.userId, table.countryCode),
    index("idx_visited_countries_user_id").on(table.userId),
  ]
);

export const visitedCountriesRelations = relations(visitedCountries, ({ one }) => ({
  user: one(user, { fields: [visitedCountries.userId], references: [user.id] }),
}));
```

- [ ] **Step 2: Create the user-profiles schema**

Create `server/db/schema/user-profiles.ts`:

```ts
import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./auth-schema";

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nationality: text("nationality"), // ISO 3166-1 alpha-2 — passport country
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_user_profiles_user_id").on(table.userId),
  ]
);

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(user, { fields: [userProfiles.userId], references: [user.id] }),
}));
```

- [ ] **Step 3: Export from schema index**

Modify `server/db/schema/index.ts` — add these two lines at the end:

```ts
export * from "./visited-countries";
export * from "./user-profiles";
```

- [ ] **Step 4: Generate and run migration**

```bash
cd /Users/jiajingteoh/Documents/ai-trip
bun run db:gen
bun run db:migrate
```

Expected: Migration created for `visited_countries` and `user_profiles` tables.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/visited-countries.ts server/db/schema/user-profiles.ts server/db/schema/index.ts server/db/migrations/
git commit -m "feat: add visited_countries and user_profiles db schema"
```

---

### Task 4: API Routes — Visited Countries CRUD

- [ ] **Step 1: Create GET /api/visited-countries**

Create `server/api/visited-countries/index.get.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { visitedCountries } from "../../db/schema";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);

  const result = await db.query.visitedCountries.findMany({
    where: eq(visitedCountries.userId, session.user.id),
    orderBy: (vc, { desc }) => [desc(vc.createdAt)],
  });

  return result;
});
```

- [ ] **Step 2: Create POST /api/visited-countries**

Create `server/api/visited-countries/index.post.ts`:

```ts
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { visitedCountries } from "../../db/schema";

const bodySchema = z.object({
  countryCode: z.string().length(2).toUpperCase(),
  countryName: z.string().min(1).max(100),
  visitedAt: z.string().date().optional(),
  notes: z.string().max(500).optional(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const body = await readValidatedBody(event, bodySchema.parse);

  // Check if already marked
  const existing = await db.query.visitedCountries.findFirst({
    where: and(
      eq(visitedCountries.userId, session.user.id),
      eq(visitedCountries.countryCode, body.countryCode)
    ),
  });

  if (existing) {
    throw createError({ statusCode: 409, message: "Country already marked as visited" });
  }

  const [result] = await db
    .insert(visitedCountries)
    .values({
      userId: session.user.id,
      countryCode: body.countryCode,
      countryName: body.countryName,
      visitedAt: body.visitedAt ?? null,
      notes: body.notes ?? null,
    })
    .returning();

  return result;
});
```

- [ ] **Step 3: Create DELETE /api/visited-countries/[countryCode]**

Create `server/api/visited-countries/[countryCode].delete.ts`:

```ts
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { visitedCountries } from "../../db/schema";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const countryCode = getRouterParam(event, "countryCode")?.toUpperCase();

  if (!countryCode || countryCode.length !== 2) {
    throw createError({ statusCode: 400, message: "Invalid country code" });
  }

  const deleted = await db
    .delete(visitedCountries)
    .where(
      and(
        eq(visitedCountries.userId, session.user.id),
        eq(visitedCountries.countryCode, countryCode)
      )
    )
    .returning();

  if (!deleted.length) {
    throw createError({ statusCode: 404, message: "Country not found in visited list" });
  }

  return { success: true };
});
```

- [ ] **Step 4: Commit**

```bash
git add server/api/visited-countries/
git commit -m "feat: add visited countries CRUD API routes"
```

---

### Task 5: API Routes — User Profile (Nationality)

- [ ] **Step 1: Create GET /api/user/profile**

Create `server/api/user/profile.get.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { userProfiles } from "../../db/schema";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);

  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
  });

  return profile ?? { userId: session.user.id, nationality: null };
});
```

- [ ] **Step 2: Create PUT /api/user/profile**

Create `server/api/user/profile.put.ts`:

```ts
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { userProfiles } from "../../db/schema";

const bodySchema = z.object({
  nationality: z.string().length(2).toUpperCase().nullable(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const body = await readValidatedBody(event, bodySchema.parse);

  const existing = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
  });

  if (existing) {
    const [updated] = await db
      .update(userProfiles)
      .set({ nationality: body.nationality })
      .where(eq(userProfiles.userId, session.user.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(userProfiles)
    .values({
      userId: session.user.id,
      nationality: body.nationality,
    })
    .returning();

  return created;
});
```

- [ ] **Step 3: Commit**

```bash
git add server/api/user/
git commit -m "feat: add user profile API routes for nationality"
```

---

### Task 6: ScratchMap Component

This is the core visual component. It renders an SVG world map from TopoJSON data, colors visited countries, and emits click events.

- [ ] **Step 1: Create the ScratchMap component**

Create `app/components/ScratchMap.vue`:

```vue
<script setup lang="ts">
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { countryByNumeric, type CountryInfo } from "../data/countries";
import worldTopoJson from "../data/countries-110m.json";

const props = defineProps<{
  visitedCodes: Set<string>; // Set of ISO alpha-2 codes
}>();

const emit = defineEmits<{
  countryClick: [country: CountryInfo];
}>();

// Convert TopoJSON to GeoJSON features
const worldData = worldTopoJson as unknown as Topology;
const countriesGeo = feature(
  worldData,
  worldData.objects.countries as GeometryCollection
);

// SVG projection — Natural Earth is great for world maps
const projection = geoNaturalEarth1()
  .scale(160)
  .translate([480, 300]);

const pathGenerator = geoPath().projection(projection);

// Precompute paths and metadata for each country
const countryPaths = computed(() =>
  countriesGeo.features.map((f) => {
    const numericId = String(f.id);
    const info = countryByNumeric.get(numericId.padStart(3, "0"));
    const isVisited = info ? props.visitedCodes.has(info.alpha2) : false;

    return {
      d: pathGenerator(f) ?? "",
      id: numericId,
      info,
      isVisited,
    };
  })
);

function handleClick(info: CountryInfo | undefined) {
  if (info) emit("countryClick", info);
}

// Hover state
const hoveredId = ref<string | null>(null);
</script>

<template>
  <div class="relative overflow-hidden rounded-2xl border border-sand-200 bg-sand-100">
    <svg
      viewBox="0 0 960 600"
      class="w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <!-- Ocean background -->
      <rect width="960" height="600" class="fill-blue-50 dark:fill-blue-950/30" />

      <!-- Country paths -->
      <path
        v-for="country in countryPaths"
        :key="country.id"
        :d="country.d"
        class="cursor-pointer stroke-sand-300 transition-colors duration-150 dark:stroke-sand-700"
        :class="[
          country.isVisited
            ? 'fill-terra-400 dark:fill-terra-500'
            : 'fill-sand-200 hover:fill-sand-300 dark:fill-sand-700 dark:hover:fill-sand-600',
          hoveredId === country.id && !country.isVisited ? 'fill-sand-300 dark:fill-sand-600' : '',
          hoveredId === country.id && country.isVisited ? 'fill-terra-500 dark:fill-terra-400' : '',
        ]"
        stroke-width="0.5"
        @click="handleClick(country.info)"
        @mouseenter="hoveredId = country.id"
        @mouseleave="hoveredId = null"
      >
        <title v-if="country.info">
          {{ country.info.name }}{{ country.isVisited ? ' (visited)' : '' }}
        </title>
      </path>
    </svg>

    <!-- Stats overlay -->
    <div class="absolute bottom-4 left-4 rounded-xl bg-white/80 px-4 py-2 backdrop-blur-sm dark:bg-sand-900/80">
      <p class="text-sm font-medium text-sand-900 dark:text-sand-100">
        <span class="text-lg font-bold text-terra-600">{{ visitedCodes.size }}</span>
        / {{ countryPaths.filter(c => c.info).length }} countries visited
      </p>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify the component renders without errors in dev**

```bash
cd /Users/jiajingteoh/Documents/ai-trip && bun run dev
```

Navigate to a test page or add a temporary usage. Verify no TypeScript errors in the console.

- [ ] **Step 3: Commit**

```bash
git add app/components/ScratchMap.vue
git commit -m "feat: add ScratchMap SVG world map component"
```

---

### Task 7: Country Detail Panel

A slide-over panel that shows when a country is clicked on the map. Shows country info, toggle visited status, and link to visa checker.

- [ ] **Step 1: Create the CountryDetailPanel component**

Create `app/components/CountryDetailPanel.vue`:

```vue
<script setup lang="ts">
import type { CountryInfo } from "../data/countries";

const props = defineProps<{
  country: CountryInfo | null;
  isVisited: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  close: [];
  toggleVisited: [country: CountryInfo];
  checkVisa: [country: CountryInfo];
}>();

const notes = ref("");
const visitedDate = ref("");
</script>

<template>
  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="translate-x-full"
    enter-to-class="translate-x-0"
    leave-active-class="duration-150 ease-in"
    leave-from-class="translate-x-0"
    leave-to-class="translate-x-full"
  >
    <div
      v-if="country"
      class="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col border-l border-sand-200 bg-white shadow-xl dark:border-sand-700 dark:bg-sand-900"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-sand-200 px-5 py-4 dark:border-sand-700">
        <div>
          <h2 class="font-display text-lg text-sand-900 dark:text-sand-100">
            {{ country.name }}
          </h2>
          <p class="text-sm text-sand-500">{{ country.region }} &middot; {{ country.alpha2 }}</p>
        </div>
        <button
          class="rounded-lg p-2 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700 dark:hover:bg-sand-800"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-5 w-5" />
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 space-y-4 overflow-y-auto p-5">
        <!-- Visited toggle -->
        <button
          class="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition"
          :class="isVisited
            ? 'border-terra-300 bg-terra-50 text-terra-700 dark:border-terra-600 dark:bg-terra-900/30 dark:text-terra-300'
            : 'border-sand-200 text-sand-700 hover:border-sand-300 hover:bg-sand-50 dark:border-sand-700 dark:text-sand-300 dark:hover:bg-sand-800'"
          :disabled="loading"
          @click="emit('toggleVisited', country)"
        >
          <Icon
            :name="isVisited ? 'lucide:check-circle-2' : 'lucide:circle'"
            class="h-5 w-5 shrink-0"
          />
          <div>
            <p class="font-medium">{{ isVisited ? 'Visited' : 'Mark as visited' }}</p>
            <p class="text-xs opacity-70">
              {{ isVisited ? 'Click to remove from your scratch map' : 'Add this country to your travel history' }}
            </p>
          </div>
        </button>

        <!-- Visa check button -->
        <button
          class="flex w-full items-center gap-3 rounded-xl border border-sand-200 px-4 py-3 text-left text-sand-700 transition hover:border-sand-300 hover:bg-sand-50 dark:border-sand-700 dark:text-sand-300 dark:hover:bg-sand-800"
          @click="emit('checkVisa', country)"
        >
          <Icon name="lucide:shield-check" class="h-5 w-5 shrink-0 text-blue-500" />
          <div>
            <p class="font-medium">Check visa requirements</p>
            <p class="text-xs opacity-70">See if you need a visa to visit</p>
          </div>
        </button>
      </div>
    </div>
  </Transition>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/CountryDetailPanel.vue
git commit -m "feat: add CountryDetailPanel slide-over component"
```

---

### Task 8: Explore Page — Scratch Map Integration

- [ ] **Step 1: Create the explore page**

Create `app/pages/explore.vue`:

```vue
<script setup lang="ts">
import type { CountryInfo } from "../data/countries";

definePageMeta({ layout: "app" });
useSeoMeta({
  title: "Explore",
  description: "Track countries you've visited on your scratch map.",
});

// Fetch visited countries
const { data: visitedList, refresh } = await useFetch("/api/visited-countries");
const visitedCodes = computed(() => new Set(visitedList.value?.map((v) => v.countryCode) ?? []));

// Selected country panel
const selectedCountry = ref<CountryInfo | null>(null);
const panelLoading = ref(false);

function handleCountryClick(country: CountryInfo) {
  selectedCountry.value = country;
}

function closePanel() {
  selectedCountry.value = null;
}

async function toggleVisited(country: CountryInfo) {
  panelLoading.value = true;
  try {
    if (visitedCodes.value.has(country.alpha2)) {
      await $fetch(`/api/visited-countries/${country.alpha2}`, { method: "DELETE" });
    } else {
      await $fetch("/api/visited-countries", {
        method: "POST",
        body: { countryCode: country.alpha2, countryName: country.name },
      });
    }
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to toggle visited status:", e);
  } finally {
    panelLoading.value = false;
  }
}

// Visa checker state
const showVisaChecker = ref(false);
const visaDestination = ref<CountryInfo | null>(null);

function handleCheckVisa(country: CountryInfo) {
  visaDestination.value = country;
  showVisaChecker.value = true;
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="font-display text-3xl text-sand-900 dark:text-sand-100">Explore</h1>
        <p class="mt-1 text-sm text-sand-500">
          Click on a country to mark it as visited or check visa requirements.
        </p>
      </div>
    </div>

    <!-- Map + Panel Container -->
    <div class="relative mt-6">
      <ScratchMap
        :visited-codes="visitedCodes"
        @country-click="handleCountryClick"
      />
      <CountryDetailPanel
        :country="selectedCountry"
        :is-visited="!!selectedCountry && visitedCodes.has(selectedCountry.alpha2)"
        :loading="panelLoading"
        @close="closePanel"
        @toggle-visited="toggleVisited"
        @check-visa="handleCheckVisa"
      />
    </div>

    <!-- Visa Checker Modal -->
    <VisaChecker
      v-if="showVisaChecker"
      :destination="visaDestination"
      @close="showVisaChecker = false"
    />
  </div>
</template>
```

- [ ] **Step 2: Add "Explore" link to app navigation**

Modify `app/layouts/app.vue`. In the nav bar, after the admin link and before the theme toggle, add an Explore link:

```vue
<NuxtLink
  to="/explore"
  class="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-sand-500 transition hover:bg-sand-100 hover:text-sand-700 dark:text-sand-400 dark:hover:bg-sand-800 dark:hover:text-sand-200"
  active-class="bg-sand-100 text-sand-900 dark:bg-sand-800 dark:text-sand-100"
>
  <Icon name="lucide:globe" class="h-4 w-4" />
  <span class="hidden sm:inline">Explore</span>
</NuxtLink>
```

- [ ] **Step 3: Protect the /explore route**

Modify `app/middleware/auth.global.ts` — add `/explore` to the list of protected routes (next to `/dashboard` and `/trips`).

- [ ] **Step 4: Commit**

```bash
git add app/pages/explore.vue app/layouts/app.vue app/middleware/auth.global.ts
git commit -m "feat: add explore page with scratch map and navigation"
```

---

## Phase 2: Visa Checker

### Task 9: Database Schema — Visa Cache

- [ ] **Step 1: Create the visa-cache schema**

Create `server/db/schema/visa-cache.ts`:

```ts
import { pgTable, text, timestamp, uuid, integer, index } from "drizzle-orm/pg-core";

export const visaCache = pgTable(
  "visa_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passportCountry: text("passport_country").notNull(), // ISO alpha-2
    destinationCountry: text("destination_country").notNull(), // ISO alpha-2
    visaStatus: text("visa_status").notNull(), // visa_free, visa_on_arrival, e_visa, visa_required
    maxStayDays: integer("max_stay_days"),
    requirements: text("requirements"), // AI-generated summary of what's needed
    processingTime: text("processing_time"),
    cost: text("cost"),
    notes: text("notes"), // Additional info (e.g., COVID rules, special conditions)
    source: text("source"), // "ai_web_search"
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_visa_cache_lookup").on(table.passportCountry, table.destinationCountry),
  ]
);
```

- [ ] **Step 2: Export from schema index**

Add to `server/db/schema/index.ts`:

```ts
export * from "./visa-cache";
```

- [ ] **Step 3: Generate and run migration**

```bash
cd /Users/jiajingteoh/Documents/ai-trip
bun run db:gen
bun run db:migrate
```

- [ ] **Step 4: Commit**

```bash
git add server/db/schema/visa-cache.ts server/db/schema/index.ts server/db/migrations/
git commit -m "feat: add visa_cache db schema"
```

---

### Task 10: Visa Checker Server Logic

- [ ] **Step 1: Create the visa checker library**

Create `server/lib/visa-checker.ts`:

```ts
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { visaCache } from "../db/schema";
import { getModel } from "./ai-config";
import { generateObject } from "ai";
import { z } from "zod";

const visaResultSchema = z.object({
  visaStatus: z.enum(["visa_free", "visa_on_arrival", "e_visa", "visa_required"]),
  maxStayDays: z.number().int().positive().nullable(),
  requirements: z.string().describe("Summary of visa requirements, documents needed, etc."),
  processingTime: z.string().nullable().describe("Typical processing time"),
  cost: z.string().nullable().describe("Visa cost if applicable"),
  notes: z.string().nullable().describe("Additional relevant info like COVID rules, transit visa needs"),
});

export type VisaResult = z.infer<typeof visaResultSchema>;

export interface VisaCheckResult extends VisaResult {
  passportCountry: string;
  destinationCountry: string;
  cached: boolean;
  fetchedAt: Date;
}

const CACHE_TTL_DAYS = 30;

export async function checkVisaRequirements(
  passportCountry: string,
  destinationCountry: string
): Promise<VisaCheckResult> {
  // Check cache first
  const cached = await db.query.visaCache.findFirst({
    where: and(
      eq(visaCache.passportCountry, passportCountry),
      eq(visaCache.destinationCountry, destinationCountry),
      gt(visaCache.expiresAt, new Date())
    ),
  });

  if (cached) {
    return {
      visaStatus: cached.visaStatus as VisaResult["visaStatus"],
      maxStayDays: cached.maxStayDays,
      requirements: cached.requirements ?? "",
      processingTime: cached.processingTime,
      cost: cached.cost,
      notes: cached.notes,
      passportCountry: cached.passportCountry,
      destinationCountry: cached.destinationCountry,
      cached: true,
      fetchedAt: cached.fetchedAt,
    };
  }

  // Fetch from AI with web search
  const model = getModel();
  const result = await generateObject({
    model,
    schema: visaResultSchema,
    prompt: `You are a travel visa expert. Research the current visa requirements for a traveler holding a ${passportCountry} passport who wants to visit ${destinationCountry}.

Provide accurate, up-to-date information about:
1. Whether a visa is required (visa_free, visa_on_arrival, e_visa, or visa_required)
2. Maximum allowed stay in days (for visa-free or visa-on_arrival)
3. What documents/requirements are needed
4. Typical processing time if a visa application is needed
5. Cost of the visa if applicable
6. Any additional notes (special conditions, transit visa needs, etc.)

Be specific and factual. If unsure about exact details, say so in the notes.`,
  });

  const visaResult = result.object;

  // Cache the result
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);

  await db
    .insert(visaCache)
    .values({
      passportCountry,
      destinationCountry,
      visaStatus: visaResult.visaStatus,
      maxStayDays: visaResult.maxStayDays,
      requirements: visaResult.requirements,
      processingTime: visaResult.processingTime,
      cost: visaResult.cost,
      notes: visaResult.notes,
      source: "ai_web_search",
      fetchedAt: new Date(),
      expiresAt,
    })
    .onConflictDoNothing();

  return {
    ...visaResult,
    passportCountry,
    destinationCountry,
    cached: false,
    fetchedAt: new Date(),
  };
}
```

- [ ] **Step 2: Verify the ai-config import path**

Check that `server/lib/ai-config.ts` exists and exports `getModel()`. If the model is configured differently (e.g., directly in `ai.ts`), adapt the import.

```bash
ls /Users/jiajingteoh/Documents/ai-trip/server/lib/ai-config*
grep -n "export.*getModel\|export.*model" /Users/jiajingteoh/Documents/ai-trip/server/lib/ai-config.ts
```

Adapt the import in `visa-checker.ts` if the export path or function name differs.

- [ ] **Step 3: Commit**

```bash
git add server/lib/visa-checker.ts
git commit -m "feat: add visa checker logic with AI lookup and caching"
```

---

### Task 11: Visa Check API Route

- [ ] **Step 1: Create POST /api/visa/check**

Create `server/api/visa/check.post.ts`:

```ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { userProfiles } from "../../db/schema";
import { checkVisaRequirements } from "../../lib/visa-checker";

const bodySchema = z.object({
  destinationCountry: z.string().length(2).toUpperCase(),
  passportCountry: z.string().length(2).toUpperCase().optional(), // Override profile nationality
});

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const body = await readValidatedBody(event, bodySchema.parse);

  // Resolve passport country: explicit param > user profile
  let passportCountry = body.passportCountry;

  if (!passportCountry) {
    const profile = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, session.user.id),
    });
    passportCountry = profile?.nationality ?? null;
  }

  if (!passportCountry) {
    throw createError({
      statusCode: 400,
      message: "No passport nationality set. Please set your nationality in settings or provide passportCountry.",
    });
  }

  if (passportCountry === body.destinationCountry) {
    return {
      visaStatus: "visa_free" as const,
      maxStayDays: null,
      requirements: "This is your home country. No visa required.",
      processingTime: null,
      cost: null,
      notes: null,
      passportCountry,
      destinationCountry: body.destinationCountry,
      cached: false,
      fetchedAt: new Date(),
    };
  }

  const result = await checkVisaRequirements(passportCountry, body.destinationCountry);
  return result;
});
```

- [ ] **Step 2: Commit**

```bash
git add server/api/visa/check.post.ts
git commit -m "feat: add visa check API endpoint"
```

---

### Task 12: Nationality Selector Component

- [ ] **Step 1: Create the NationalitySelector component**

Create `app/components/NationalitySelector.vue`:

```vue
<script setup lang="ts">
import { countries, countryByAlpha2 } from "../data/countries";

const props = defineProps<{
  modelValue: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string | null];
}>();

const searchQuery = ref("");
const isOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

const selectedName = computed(() => {
  if (!props.modelValue) return null;
  return countryByAlpha2.get(props.modelValue)?.name ?? props.modelValue;
});

const filteredCountries = computed(() => {
  if (!searchQuery.value) return countries;
  const q = searchQuery.value.toLowerCase();
  return countries.filter(
    (c) => c.name.toLowerCase().includes(q) || c.alpha2.toLowerCase().includes(q)
  );
});

function select(alpha2: string) {
  emit("update:modelValue", alpha2);
  isOpen.value = false;
  searchQuery.value = "";
}

function handleClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => document.addEventListener("click", handleClickOutside));
onUnmounted(() => document.removeEventListener("click", handleClickOutside));
</script>

<template>
  <div ref="dropdownRef" class="relative">
    <button
      class="flex w-full items-center justify-between rounded-xl border border-sand-200 bg-white px-4 py-2.5 text-left text-sm transition hover:border-sand-300 dark:border-sand-700 dark:bg-sand-800 dark:hover:border-sand-600"
      @click.stop="isOpen = !isOpen"
    >
      <span :class="selectedName ? 'text-sand-900 dark:text-sand-100' : 'text-sand-400'">
        {{ selectedName ?? 'Select your passport nationality' }}
      </span>
      <Icon
        name="lucide:chevron-down"
        class="h-4 w-4 text-sand-400 transition-transform"
        :class="{ 'rotate-180': isOpen }"
      />
    </button>

    <Transition
      enter-active-class="duration-150 ease-out"
      enter-from-class="scale-95 opacity-0"
      enter-to-class="scale-100 opacity-100"
      leave-active-class="duration-100 ease-in"
      leave-from-class="scale-100 opacity-100"
      leave-to-class="scale-95 opacity-0"
    >
      <div
        v-if="isOpen"
        class="absolute z-20 mt-1 w-full origin-top rounded-xl border border-sand-200 bg-white shadow-lg dark:border-sand-700 dark:bg-sand-800"
      >
        <div class="border-b border-sand-100 p-2 dark:border-sand-700">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search countries..."
            class="w-full rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder-sand-400 focus:border-terra-400 focus:outline-none dark:border-sand-700 dark:bg-sand-900 dark:text-sand-100"
          />
        </div>
        <ul class="max-h-60 overflow-y-auto py-1">
          <li
            v-for="c in filteredCountries"
            :key="c.alpha2"
            class="cursor-pointer px-4 py-2 text-sm text-sand-700 transition hover:bg-sand-50 dark:text-sand-300 dark:hover:bg-sand-700"
            :class="{ 'bg-terra-50 text-terra-700 dark:bg-terra-900/30 dark:text-terra-300': c.alpha2 === modelValue }"
            @click="select(c.alpha2)"
          >
            {{ c.name }}
            <span class="ml-1 text-xs text-sand-400">{{ c.alpha2 }}</span>
          </li>
          <li v-if="!filteredCountries.length" class="px-4 py-3 text-center text-sm text-sand-400">
            No countries found
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/NationalitySelector.vue
git commit -m "feat: add NationalitySelector dropdown component"
```

---

### Task 13: Visa Checker Component

- [ ] **Step 1: Create the VisaChecker component**

Create `app/components/VisaChecker.vue`:

```vue
<script setup lang="ts">
import type { CountryInfo } from "../data/countries";
import { countryByAlpha2 } from "../data/countries";

const props = defineProps<{
  destination: CountryInfo | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

// Fetch user profile for nationality
const { data: profile, refresh: refreshProfile } = await useFetch("/api/user/profile");
const nationality = ref<string | null>(profile.value?.nationality ?? null);

// Visa check state
const visaResult = ref<{
  visaStatus: string;
  maxStayDays: number | null;
  requirements: string;
  processingTime: string | null;
  cost: string | null;
  notes: string | null;
  cached: boolean;
  fetchedAt: string;
} | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

// Save nationality on change
watch(nationality, async (val) => {
  if (val !== profile.value?.nationality) {
    await $fetch("/api/user/profile", {
      method: "PUT",
      body: { nationality: val },
    });
    await refreshProfile();
  }
});

async function checkVisa() {
  if (!nationality.value || !props.destination) return;

  loading.value = true;
  error.value = null;
  visaResult.value = null;

  try {
    const result = await $fetch("/api/visa/check", {
      method: "POST",
      body: {
        destinationCountry: props.destination.alpha2,
        passportCountry: nationality.value,
      },
    });
    visaResult.value = result;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Failed to check visa requirements";
  } finally {
    loading.value = false;
  }
}

// Auto-check if nationality is already set
watch(
  () => props.destination,
  () => {
    visaResult.value = null;
    if (nationality.value && props.destination) checkVisa();
  },
  { immediate: true }
);

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  visa_free: { label: "Visa Free", color: "text-green-600 bg-green-50 border-green-200", icon: "lucide:check-circle" },
  visa_on_arrival: { label: "Visa on Arrival", color: "text-blue-600 bg-blue-50 border-blue-200", icon: "lucide:clock" },
  e_visa: { label: "e-Visa Required", color: "text-amber-600 bg-amber-50 border-amber-200", icon: "lucide:globe" },
  visa_required: { label: "Visa Required", color: "text-red-600 bg-red-50 border-red-200", icon: "lucide:shield-alert" },
};
</script>

<template>
  <!-- Modal backdrop -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="w-full max-w-lg rounded-2xl border border-sand-200 bg-white shadow-2xl dark:border-sand-700 dark:bg-sand-900">
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-sand-200 px-6 py-4 dark:border-sand-700">
        <div>
          <h2 class="font-display text-lg text-sand-900 dark:text-sand-100">
            Visa Requirements
          </h2>
          <p v-if="destination" class="text-sm text-sand-500">
            Travelling to {{ destination.name }}
          </p>
        </div>
        <button
          class="rounded-lg p-2 text-sand-400 transition hover:bg-sand-100 dark:hover:bg-sand-800"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-5 w-5" />
        </button>
      </div>

      <!-- Body -->
      <div class="space-y-4 p-6">
        <!-- Nationality selector -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-sand-700 dark:text-sand-300">
            Your passport nationality
          </label>
          <NationalitySelector v-model="nationality" />
        </div>

        <!-- Check button (if nationality changed or no auto-check) -->
        <button
          v-if="nationality && !loading && !visaResult"
          class="w-full rounded-xl bg-terra-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-terra-600"
          @click="checkVisa"
        >
          Check Visa Requirements
        </button>

        <!-- Loading -->
        <div v-if="loading" class="flex items-center justify-center py-8">
          <Icon name="lucide:loader" class="h-6 w-6 animate-spin text-terra-400" />
          <span class="ml-2 text-sm text-sand-500">Checking visa requirements...</span>
        </div>

        <!-- Error -->
        <div v-if="error" class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {{ error }}
        </div>

        <!-- Result -->
        <div v-if="visaResult" class="space-y-3">
          <!-- Status badge -->
          <div
            class="flex items-center gap-2 rounded-xl border px-4 py-3"
            :class="statusConfig[visaResult.visaStatus]?.color ?? 'text-sand-600 bg-sand-50 border-sand-200'"
          >
            <Icon
              :name="statusConfig[visaResult.visaStatus]?.icon ?? 'lucide:info'"
              class="h-5 w-5 shrink-0"
            />
            <span class="font-semibold">
              {{ statusConfig[visaResult.visaStatus]?.label ?? visaResult.visaStatus }}
            </span>
            <span v-if="visaResult.maxStayDays" class="ml-auto text-sm opacity-75">
              Up to {{ visaResult.maxStayDays }} days
            </span>
          </div>

          <!-- Requirements -->
          <div v-if="visaResult.requirements" class="rounded-xl border border-sand-200 p-4 dark:border-sand-700">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-sand-500">Requirements</h3>
            <p class="mt-1 text-sm text-sand-700 whitespace-pre-line dark:text-sand-300">
              {{ visaResult.requirements }}
            </p>
          </div>

          <!-- Details grid -->
          <div class="grid grid-cols-2 gap-3">
            <div v-if="visaResult.processingTime" class="rounded-xl border border-sand-200 p-3 dark:border-sand-700">
              <p class="text-xs text-sand-500">Processing Time</p>
              <p class="mt-0.5 text-sm font-medium text-sand-900 dark:text-sand-100">
                {{ visaResult.processingTime }}
              </p>
            </div>
            <div v-if="visaResult.cost" class="rounded-xl border border-sand-200 p-3 dark:border-sand-700">
              <p class="text-xs text-sand-500">Cost</p>
              <p class="mt-0.5 text-sm font-medium text-sand-900 dark:text-sand-100">
                {{ visaResult.cost }}
              </p>
            </div>
          </div>

          <!-- Notes -->
          <div v-if="visaResult.notes" class="rounded-xl border border-sand-200 bg-sand-50 p-4 dark:border-sand-700 dark:bg-sand-800">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-sand-500">Additional Notes</h3>
            <p class="mt-1 text-sm text-sand-600 whitespace-pre-line dark:text-sand-400">
              {{ visaResult.notes }}
            </p>
          </div>

          <!-- Cache indicator -->
          <p class="text-center text-xs text-sand-400">
            {{ visaResult.cached ? 'Cached result' : 'Fresh lookup' }}
            &middot; Last checked {{ new Date(visaResult.fetchedAt).toLocaleDateString() }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/VisaChecker.vue
git commit -m "feat: add VisaChecker modal component with AI-powered lookup"
```

---

### Task 14: Settings Page — Nationality Setting

Add a nationality section to the existing settings page so users can set their passport nationality outside the visa checker flow.

- [ ] **Step 1: Add nationality section to settings**

Modify `app/pages/settings.vue`. Add a new section after the Profile card:

In the `<script setup>`:
```ts
const { data: profile, refresh: refreshProfile } = await useFetch("/api/user/profile");
const nationality = ref<string | null>(profile.value?.nationality ?? null);
const savingNationality = ref(false);

async function saveNationality() {
  savingNationality.value = true;
  try {
    await $fetch("/api/user/profile", {
      method: "PUT",
      body: { nationality: nationality.value },
    });
    await refreshProfile();
  } catch (e: unknown) {
    console.error("Failed to save nationality:", e);
  } finally {
    savingNationality.value = false;
  }
}

watch(nationality, () => saveNationality());
```

In the `<template>`, after the Profile section and before AI Usage:
```vue
<!-- Nationality / Passport -->
<div class="rounded-2xl border border-sand-200 bg-white p-6">
  <h2 class="text-sm font-semibold text-sand-900">Passport Nationality</h2>
  <p class="mt-1 text-xs text-sand-500">Used for visa requirement checks</p>
  <div class="mt-4">
    <NationalitySelector v-model="nationality" />
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add app/pages/settings.vue
git commit -m "feat: add nationality setting to settings page"
```

---

### Task 15: Rate Limiting & CSP Updates

- [ ] **Step 1: Update nuxt.config.ts for rate limiting**

Add rate limit rules for the new API routes. In the `routeRules` section of `nuxt.config.ts`:

```ts
"/api/visa/check": {
  security: {
    rateLimiter: { tokensPerInterval: 10, interval: 60000 },
  },
},
"/api/visited-countries/**": {
  security: {
    rateLimiter: { tokensPerInterval: 60, interval: 60000 },
  },
},
```

The visa check route is rate-limited more aggressively because it calls the AI model.

- [ ] **Step 2: Commit**

```bash
git add nuxt.config.ts
git commit -m "chore: add rate limiting for visa check and visited countries APIs"
```

---

### Task 16: Final Integration Testing

- [ ] **Step 1: Start dev server and verify all routes**

```bash
cd /Users/jiajingteoh/Documents/ai-trip && bun run dev
```

- [ ] **Step 2: Test scratch map flow**

1. Navigate to `/explore`
2. Verify the world map renders with all countries
3. Click a country → detail panel slides open
4. Click "Mark as visited" → country turns terra color on map
5. Click again → country is unmarked
6. Verify stats counter updates

- [ ] **Step 3: Test visa checker flow**

1. From country detail panel, click "Check visa requirements"
2. If no nationality set, verify nationality selector appears
3. Select a nationality → visa check auto-runs
4. Verify result displays with status badge, requirements, etc.
5. Check same country again → verify cached result returns faster

- [ ] **Step 4: Test settings integration**

1. Navigate to `/settings`
2. Verify nationality selector appears
3. Set nationality → go to explore → check visa → nationality should be pre-filled

- [ ] **Step 5: Verify dark mode**

Toggle dark mode and verify all new components look correct.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: scratch map and visa checker feature complete"
```
