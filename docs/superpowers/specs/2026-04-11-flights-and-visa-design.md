# Flight Details & Visa Requirements Feature

## Overview

Allow users to track flight details (times, gates, status) and automatically surface visa requirements based on their passport(s). Flights can exist standalone or be linked to trips. Visa data is served from a bundled dataset with zero external API calls.

## Data Model

### `user_passports`

Supports multiple passports per user (dual citizenship). Replaces the single `nationality` field on `user_profiles` as the source of truth for visa checks.

| Column      | Type                 | Notes                                      |
| ----------- | -------------------- | ------------------------------------------ |
| id          | uuid (defaultRandom) | PK                                         |
| userId      | text FK -> user      | cascade delete                             |
| countryCode | char(2)              | ISO alpha-2 (e.g. "MY", "US")              |
| label       | text                 | Optional user label ("Malaysian passport") |
| isDefault   | boolean              | Default passport for visa checks           |
| createdAt   | timestamp            | defaultNow                                 |

- Unique constraint on `(userId, countryCode)`
- Migration: seed from existing `user_profiles.nationality` for existing users

### `flights`

| Column           | Type                 | Notes                                         |
| ---------------- | -------------------- | --------------------------------------------- |
| id               | uuid (defaultRandom) | PK                                            |
| userId           | text FK -> user      | cascade delete                                |
| tripId           | uuid FK -> trips     | nullable, cascade set null                    |
| flightNumber     | text                 | e.g. "SQ638"                                  |
| flightDate       | date                 | departure date                                |
| airline          | text                 | nullable, from API                            |
| departureAirport | text                 | IATA code, e.g. "SIN"                         |
| arrivalAirport   | text                 | IATA code, e.g. "NRT"                         |
| departureTime    | timestamp            | scheduled                                     |
| arrivalTime      | timestamp            | scheduled                                     |
| terminal         | text                 | nullable                                      |
| gate             | text                 | nullable                                      |
| status           | text                 | "scheduled", "delayed", "landed", "cancelled" |
| rawApiResponse   | jsonb                | full cached API response                      |
| apiLastFetchedAt | timestamp            | when we last hit the API                      |
| createdAt        | timestamp            | defaultNow                                    |
| updatedAt        | timestamp            | $onUpdate                                     |

- Unique constraint on `(userId, flightNumber, flightDate)`

### `visa_requirements` (static dataset)

| Column             | Type                 | Notes                                                    |
| ------------------ | -------------------- | -------------------------------------------------------- |
| id                 | uuid (defaultRandom) | PK                                                       |
| passportCountry    | char(2)              | ISO alpha-2                                              |
| destinationCountry | char(2)              | ISO alpha-2                                              |
| visaStatus         | text                 | "visa-free", "visa-required", "evisa", "visa-on-arrival" |
| maxStayDays        | integer              | nullable                                                 |
| updatedAt          | timestamp            | when dataset was last imported                           |

- Unique constraint on `(passportCountry, destinationCountry)`
- Replaces the existing `visa_cache` approach with a local dataset

## Server API Routes

### Flight Routes

| Method | Route                    | Description                                                    |
| ------ | ------------------------ | -------------------------------------------------------------- |
| GET    | `/api/flights`           | List all flights for current user (optional `?tripId=` filter) |
| POST   | `/api/flights`           | Add a flight (flightNumber + flightDate, triggers API lookup)  |
| GET    | `/api/flights/:id`       | Get single flight with fresh-on-load fetch                     |
| PATCH  | `/api/flights/:id`       | Update (link/unlink trip)                                      |
| DELETE | `/api/flights/:id`       | Remove a flight                                                |
| GET    | `/api/trips/:id/flights` | Get flights linked to a specific trip                          |

**Fresh-on-load logic (GET `/api/flights/:id`):**

- If `apiLastFetchedAt` is older than 2 hours, fetch fresh data from AeroDataBox and update the row
- If the API call fails (rate limit, network), serve stale cached data — never error out
- If the flight date is in the past (>24h after arrival), stop refreshing — data is final

### Passport Routes

| Method | Route                     | Description                                  |
| ------ | ------------------------- | -------------------------------------------- |
| GET    | `/api/user/passports`     | List user's passports                        |
| POST   | `/api/user/passports`     | Add a passport (countryCode, optional label) |
| PATCH  | `/api/user/passports/:id` | Update (label, set as default)               |
| DELETE | `/api/user/passports/:id` | Remove a passport                            |

### Visa Route

| Method | Route                            | Description                                                                         |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/api/visa/check?destination=JP` | Check visa status for all user passports against destination, return most favorable |

Replaces existing `POST /api/visa/check`. Reads from `visa_requirements` DB table instead of external API.

**Best passport logic:** Query all user passports, look up each against the destination, return the one with the most favorable status. Priority order: visa-free > visa-on-arrival > evisa > visa-required.

## Flight API Integration

### Provider

AeroDataBox via RapidAPI (free tier, ~600 calls/month).

### Server Library (`/server/lib/flight-api.ts`)

Wraps AeroDataBox calls using the same `defineCachedFunction` pattern as Google Maps:

- `lookupFlight(flightNumber, date)` — 2-hour cache
- Maps raw API response to `flights` table columns
- Handles IATA code extraction for departure/arrival airports

## Visa Dataset Import

### Source

[Passport Index Dataset](https://github.com/ilyankou/passport-index-dataset) — open-source CSV, ~39,000 country pairs.

### Import Task (`/server/tasks/import-visa-data.ts`)

Nuxt server task that:

1. Fetches the latest CSV from the GitHub raw URL
2. Parses and normalizes visa status values
3. Extracts `maxStayDays` from numeric entries
4. Upserts all rows into `visa_requirements` in a single transaction

### Status Normalization

| Dataset value             | Enum              | maxStayDays |
| ------------------------- | ----------------- | ----------- |
| Numeric (e.g. "90")       | "visa-free"       | that number |
| "visa free"               | "visa-free"       | null        |
| "visa on arrival" / "VOA" | "visa-on-arrival" | null        |
| "e-visa"                  | "evisa"           | null        |
| "visa required" / "-1"    | "visa-required"   | null        |

### Run frequency

- Manually via `npx nuxt run task import-visa-data` for initial setup
- Optionally monthly via CI — visa requirements rarely change

## Frontend

### New Page: My Flights (`/app/pages/flights.vue`)

Top-level nav item alongside Trips, Explore, etc.

**Layout:**

- **Add Flight form** — flight number input + date picker, submits to POST `/api/flights`
- **Upcoming Flights** — cards sorted by departure date (future flights)
- **Past Flights** — collapsed by default, sorted descending

### Flight Card Component (`FlightCard.vue`)

Displays:

- Airline + flight number (e.g. "Singapore Airlines SQ638")
- Route: departure -> arrival airport codes with city names
- Date + times with timezone
- Status badge: green (on time/landed), yellow (delayed), red (cancelled)
- Terminal + gate when available
- Visa badge: small indicator next to arrival airport — auto-computed from user's passports, shows best result
- Trip link: if linked, shows trip name as clickable chip; if unlinked, shows "Link to trip" dropdown

### Trip Detail Integration

On `/app/pages/trips/[id].vue`:

- New "Flights" section/tab alongside existing tabs
- Shows flights linked to that trip using `FlightCard`
- "Add flight" button pre-linked to the trip

### Settings — Passports

New section on `/app/pages/settings.vue`:

- List of passports with country flag + name + label
- "Add passport" with country dropdown + optional label
- Default passport indicator (star icon), click to change
- Delete with confirmation

### Visa Display

No dedicated visa page. Visa info is surfaced contextually:

- On flight cards (badge next to arrival airport)
- On trip overview (if flights are linked, show visa status for destination)

## IATA-to-Country Mapping

Visa checks need to map arrival airport IATA codes to country codes. Use a static TypeScript map (`/server/utils/iata-country-map.ts`) bundled in the app (e.g. `NRT` -> `JP`, `LAX` -> `US`). This is a simple `Record<string, string>` exported as a constant — no DB table needed since IATA codes are stable and the list is finite (~1,000 major airports). The Passport Index Dataset uses ISO alpha-2 country codes, so the mapping is IATA -> ISO alpha-2.

## Migration Path

1. Create `user_passports`, `flights`, `visa_requirements` tables
2. Seed `user_passports` from existing `user_profiles.nationality` for users who have it set
3. Run visa dataset import task
4. Update visa check endpoint to use new table
5. Keep `user_profiles.nationality` field for backwards compatibility during transition
