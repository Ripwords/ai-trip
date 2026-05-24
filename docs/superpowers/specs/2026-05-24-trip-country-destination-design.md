# Structured country destination for trips

## Problem

A trip's `destination` column is a single freeform text field. Today it does double duty as both the trip's display name and its geographic identifier, which means:

- The map can't center on the trip's location until at least one activity is added — empty trips show world view at `{lat:0, lng:0}` zoom 2.
- Currency is a manual dropdown that defaults to USD with no relationship to where the trip is going.
- The same string is sometimes a place (`"Tokyo, Japan"`) and sometimes a personal label (`"Honeymoon 2026"`), so we can't reliably derive anything from it.

## Goal

Make every trip carry a structured ISO country code in addition to an optional display name. Use the country to:

1. Center the map on the country when no activities exist yet.
2. Auto-select the trip's currency from the country's primary currency (user can still override).
3. Keep the trip display name flexible — users who want a custom label like `"Honeymoon 2026"` can still set one.

## Non-goals

- Multi-country trips. One country per trip. A Japan + Korea itinerary picks one country as the home; activities in other countries still render fine.
- City-level granularity. Country is enough for the map fallback and currency, and avoids the precision-vs-effort tradeoff of city pickers.
- Touching the multi-point map bounds logic — `fitBounds` already handles trips with activities correctly. Country center is purely the empty-state fallback.

## Design

### Schema

Add two new columns to `trips`, keep the legacy `destination` column temporarily for compat.

```ts
// server/db/schema/trips.ts
export const trips = pgTable("trips", {
  // ...existing
  destination: text("destination").notNull(), // legacy, dropped in follow-up PR
  name: text("name"), // NEW — optional display name
  countryCode: char("country_code", { length: 2 }), // NEW — ISO 3166-1 alpha-2
  // ...
})
```

- `countryCode` is nullable until the backfill completes; phase 2 migration makes it `NOT NULL`.
- `name` stays nullable forever. NULL means "use the auto label `Trip to <country.name>`".
- New index: `idx_trips_country_code`.

### Static country data module

A single shipped module is the source of truth for the picker, currency, and map center.

```ts
// app/utils/countries.ts (also imported server-side)
export interface Country {
  code: string // ISO 3166-1 alpha-2, e.g. "JP"
  name: string // "Japan"
  flag: string // "🇯🇵"
  lat: number // geographic centroid
  lng: number
  zoom: number // recommended initial zoom (4 large, 7 small)
  currency: string // ISO 4217 of the primary circulating currency
}

export const COUNTRIES: Country[]
export const COUNTRIES_BY_CODE: Record<string, Country>
```

Seeded once from a public ISO list. Eurozone members → `EUR`; UK → `GBP`; territories that circulate a foreign currency (e.g. Ecuador) → that foreign currency (`USD`), not their parent country's.

### New trip form (`app/pages/trips/new.vue`)

```
┌─────────────────────────────────────┐
│ Destination *                       │
│ [🇯🇵 Japan                      ▾]  │  combobox, type-to-filter
│                                     │
│ + Add a custom name                 │  reveal-on-click
│                                     │
│ Start date *      End date *        │
│                                     │
│ Budget            Pace              │
│                                     │
│ Currency *                          │
│ [JPY (¥)                        ▾]  │  auto-fills from country, editable
│                                     │
│ Travel Style: [chips...]            │
└─────────────────────────────────────┘
```

- Country combobox is required; submit disabled until picked. Renders flag + name; stored value is the ISO code.
- Picking a country auto-sets `currencyCode` to `country.currency`. If that ISO currency isn't in the existing 16-item dropdown, it's added on the fly so the user sees the selection.
- "Add a custom name" link reveals a text input below the combobox (placeholder `e.g. Honeymoon 2026`, max 100 chars). If left blank, the trip page title falls back to `Trip to <country.name>`.

### Shared combobox component

`app/components/CountryCombobox.vue` — used by both `pages/trips/new.vue` and `components/EditTripModal.vue`.

- Props: `modelValue: string | null`, `required: boolean`
- Emits: `update:modelValue`
- Built on whatever combobox primitive the project already uses (check `app/components` for an existing pattern before adding a dep).

### Edit modal (`app/components/EditTripModal.vue`)

- Replace the freeform `destination` input with `<CountryCombobox>`.
- Add an always-visible "Trip name" text input (different from the new-trip form — editing is when users most want to rename). Pre-fills with `trip.name ?? ""`.
- Currency dropdown stays as-is.
- Save computes `countryChanged`, `nameChanged`, `datesChanged`; PUT only sends changed fields.

### API + validation (`server/utils/schemas.ts`, `server/api/trips/index.post.ts`, `[id].put.ts`)

```ts
export const createTripSchema = z.object({
  countryCode: z.string().length(2).toUpperCase(),
  name: z.string().min(1).max(100).nullish(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  preferences: tripPreferencesSchema.optional(),
  currencyCode: z.string().length(3).optional(),
})

export const updateTripSchema = createTripSchema
  .partial()
  .extend({
    status: tripStatusEnum.optional(),
    budget: z.string().nullish(),
    tripNotes: z.string().nullish(),
  })
  .refine(/* endDate >= startDate */)
```

POST handler:

- `throw createError(400, "Unknown country")` if `countryCode` not in `COUNTRIES_BY_CODE`.
- Insert `name`, `countryCode`, and the legacy `destination = name ?? country.name` (so legacy reads keep working).
- Default `currencyCode` to `country.currency` if body omitted it.

PUT handler:

- Same country validation when `countryCode` is present.
- Keep the legacy `destination` column in sync on every write: `destination = name ?? country.name`.

### Response shape (`app/types/trip.ts`)

```ts
interface TripResponse {
  // ...existing
  destination: string // legacy, still emitted during transition
  name: string | null // NEW
  countryCode: string // NEW (non-null after backfill)
}
```

Trip page title helper: `trip.name ?? \`Trip to ${COUNTRIES_BY_CODE[trip.countryCode]?.name ?? "your destination"}\``.

### Map centering (`app/components/TripMap.vue`, `TripOverviewMap.vue`)

Add prop `countryCode?: string | null`. Modify the empty-state branch:

```ts
if (totalPoints === 0) {
  const country = props.countryCode ? COUNTRIES_BY_CODE[props.countryCode] : null
  if (country) {
    map.setCenter({ lat: country.lat, lng: country.lng })
    map.setZoom(country.zoom)
  } else {
    map.setCenter({ lat: 0, lng: 0 })
    map.setZoom(2)
  }
  updatePolylines()
  return
}
```

`fitBounds` path for trips with ≥1 point is untouched. Call sites pass `:country-code="trip.countryCode"`.

### Migration

**Phase 1 — additive (this PR):**

```sql
-- server/db/migrations/00XX_add_trip_country.sql
ALTER TABLE trips ADD COLUMN name text;
ALTER TABLE trips ADD COLUMN country_code char(2);

UPDATE trips SET name = destination WHERE name IS NULL;

CREATE INDEX idx_trips_country_code ON trips(country_code);
```

**Country inference script** (`server/db/backfill-trip-country.ts`, manual one-shot via `bun run`):

For each trip where `country_code IS NULL`:

1. Collect every place ID across the trip's activities + flight arrival airports.
2. Read cached Google Place Details (the existing `defineCachedFunction` in `server/lib/google-maps.ts` already caches these).
3. Pull country from `addressComponents` (type `"country"` → `short_name` = ISO alpha-2).
4. Most-frequent country across all place IDs wins; tie-break on the first activity's day order.
5. `UPDATE trips SET country_code = ? WHERE id = ?`.
6. Trips with no activities/flights are skipped — the trip page shows a "Set a destination" prompt that opens the EditTripModal.

No new paid Google calls — entire backfill runs off the existing cache.

**Phase 2 — drop legacy (follow-up PR, not this one):**

```sql
ALTER TABLE trips ALTER COLUMN country_code SET NOT NULL;
ALTER TABLE trips DROP COLUMN destination;
```

Gated on: backfill ran in prod, all readers of `trip.destination` removed.

### Frontend handling of NULL country (transition state)

- Trip page title falls back to `trip.name ?? "Untitled trip"`.
- Map falls back to world view.
- Subtle banner on the trip page: "Set a destination" → button opens `EditTripModal` scrolled to the country field.

## Risks

- **Static data drift.** Country renames or currency changes (rare) require a manual data refresh. Acceptable — cost is one PR every few years.
- **Currency override conflicts.** A user could pick Japan, accept `JPY`, then later we add `JPY` to the visible dropdown — both behaviors must coexist. Handled by the "add to dropdown on the fly" rule.
- **Backfill misses trips with no place data.** Trips without any geocoded activities or flights stay NULL until the user edits. Acceptable — the banner makes this user-resolvable.
- **Phase 2 gating.** If we forget to remove a `trip.destination` reader before dropping the column, the page breaks. Mitigation: grep + manual pass before opening the phase 2 PR.

## Out of scope

- Multi-country trips.
- City-level structured destinations.
- Refactoring `TripMap.vue` beyond the empty-state branch.
- Replacing the existing currency dropdown's hand-curated 16-item list with a full ISO 4217 list. We only add currencies on the fly as they come up via country selection.
