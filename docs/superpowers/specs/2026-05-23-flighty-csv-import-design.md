# Flighty CSV Importer — Design

**Date:** 2026-05-23
**Status:** Draft

## Purpose

Let users bring their existing Flighty (flight tracker app) history into the global **My Flights** page by uploading a Flighty CSV export. Imported flights are unassigned by default; users link them to project trips afterward via the existing per-card UI.

This is a one-direction importer. No live sync, no two-way binding, no re-export.

## Non-goals

- Do not change the `flights` table schema. Only fields the schema already exposes are populated. Seat, PNR, cabin class, notes, aircraft type, tail number, and Flighty's internal UUIDs are dropped.
- Do not auto-assign imported flights to trips. Assignment stays manual via the existing `FlightCard` link-to-trip UI.
- Do not store the uploaded CSV file. It is parsed in memory per request.
- No background job. Import is synchronous and bounded by the user's CSV size; a typical Flighty export is under a few hundred rows.

## User flow

1. On `/flights`, an **Import from Flighty** button sits next to the existing **Add Flight** form.
2. Click → `ImportFlightyModal` opens with a `.csv` file picker.
3. User picks a file → request goes to `POST /api/flights/import/preview` → modal renders a preview:
   - Counts: total rows, importable, duplicates (already in account), invalid (parse errors)
   - First ~20 importable rows in a compact table (date, flight number, From→To)
   - Collapsible "Issues" list for invalid rows (line number + reason)
4. User clicks **Import** → `POST /api/flights/import` with the same file → modal shows result (`Imported X · Skipped Y · Failed Z`) → flights list refreshes → modal closes.
5. User clicks **Cancel** or closes the modal → nothing written.

## Field mapping

Flighty CSV column → `flights` column:

| flights column        | Source                                                                          |
| --------------------- | ------------------------------------------------------------------------------- |
| `flightNumber`        | `Airline` + `Flight` concatenated (e.g., `EVA` + `228` → `EVA228`)              |
| `flightDate`          | `Date` (already ISO `YYYY-MM-DD`)                                               |
| `airline`             | `Airline` (ICAO code, stored as-is)                                             |
| `departureAirport`    | `From` (IATA)                                                                   |
| `arrivalAirport`      | `To` (IATA)                                                                     |
| `departureTime`       | `Gate Departure (Actual)` ?? `Gate Departure (Scheduled)`                       |
| `arrivalTime`         | `Gate Arrival (Actual)` ?? `Gate Arrival (Scheduled)`                           |
| `terminal`            | `Dep Terminal`                                                                  |
| `gate`                | `Dep Gate`                                                                      |
| `status`              | `Canceled=true` → `"cancelled"`; else past → `"landed"`, future → `"scheduled"` |
| `tripId`              | always `null` on import                                                         |
| `rawApiResponse`      | `null` (unless future-flight lookup succeeds — see below)                       |
| `apiLastFetchedAt`    | `null` (unless future-flight lookup succeeds)                                   |
| `lookupSchemaVersion` | current `FLIGHT_LOOKUP_SCHEMA_VERSION`                                          |

All other Flighty columns (`Arr Terminal`, `Arr Gate`, `Diverted To`, `Aircraft Type Name`, `Tail Number`, `PNR`, `Seat`, `Seat Type`, `Cabin Class`, `Flight Reason`, `Notes`, and all `*Flighty ID` columns) are read but discarded — the existing schema has no place for them.

## Hybrid sourcing rule

Per row, after parsing and dedupe:

- If `flightDate >= today`: call `lookupFlight(flightNumber, flightDate)`.
  - On non-null result → use API-enriched fields, fall back to CSV for anything the API returns null on.
  - On null (no API key, 404, error) → use CSV mapping above.
- If `flightDate < today`: skip the API call entirely and use CSV mapping. Historical lookups are likely to 404 and waste quota.

AeroDataBox accepts ICAO flight numbers, so `EVA228` works for the lookup without code-table conversion.

## Dedupe rule

The `flights` table already has `uniqueIndex("idx_flights_user_flight_date").on(userId, flightNumber, flightDate)`. The importer respects it: any row whose `(userId, flightNumber, flightDate)` matches an existing flight is **skipped silently** and counted as a duplicate. Existing rows are never touched — no merge, no overwrite. This protects manually-edited and AeroDataBox-enriched data.

## Architecture

### `server/lib/flighty-import.ts` (new)

Pure CSV → typed rows utility. No DB, no HTTP. Easy to unit-test.

```ts
export interface ParsedFlightyRow {
  line: number // 1-indexed, header is line 1
  flightNumber: string // `${Airline}${Flight}`
  flightDate: string // YYYY-MM-DD
  airline: string
  departureAirport: string
  arrivalAirport: string
  departureTime: Date | null
  arrivalTime: Date | null
  terminal: string | null
  gate: string | null
  status: "scheduled" | "landed" | "cancelled"
}

export interface FlightyParseResult {
  rows: ParsedFlightyRow[]
  errors: { line: number; reason: string }[]
}

export function parseFlightyCsv(input: string, today: Date): FlightyParseResult
```

Responsibilities:

- Validate header row matches Flighty's known shape (presence of required columns: `Date, Airline, Flight, From, To`). On mismatch, throw a `FlightyImportError("This doesn't look like a Flighty export.")`.
- Per row: require non-empty `Date, Airline, Flight, From, To`. Reject malformed dates. Skip but record bad rows in `errors`.
- Derive `status` per the table above (uses `today` for past/future split).

### `POST /api/flights/import/preview` (new)

Accepts `multipart/form-data` with one `file` field.

```ts
// Response
{
  totalRows: number          // data rows in the CSV (excludes header)
  importableCount: number    // valid rows that are not duplicates
  duplicateCount: number     // valid rows whose (flightNumber, flightDate) already exists for this user
  invalidCount: number
  preview: PreviewRow[]      // first ~20 importable rows for the table
  issues: { line: number; reason: string }[]
}

interface PreviewRow {
  line: number
  flightDate: string
  flightNumber: string
  departureAirport: string
  arrivalAirport: string
  isDuplicate: boolean       // for visual flag if we choose to show duplicates in the preview
}
```

Steps:

1. `requireAuth(event)`.
2. Read file (cap at e.g. 2 MB; reject larger with friendly message).
3. `parseFlightyCsv(text, new Date())`.
4. Query existing flights for this user with matching `(flightNumber, flightDate)` pairs — one query with an `inArray` on the composite, or a single query of `userId` flights and a `Set` lookup in memory. Memory lookup is simpler and the row count per user is small.
5. Build `preview` (sorted by date), `issues` (from parse errors), counts.
6. Return.

No DB writes.

### `POST /api/flights/import` (new)

Same multipart shape as `/preview`. Re-parses the file server-side — client never gets to control which rows are written.

```ts
// Response
interface ImportResponse {
  imported: number
  skipped: number // duplicates
  failed: number // rows that errored at insert/lookup time
  issues: Array<{ line: number; reason: string }>
}
```

Steps:

1. `requireAuth(event)`.
2. Read file, re-parse.
3. Fetch existing `(flightNumber, flightDate)` pairs for the user into a Set.
4. For each parsed row:
   - If in dedupe set → increment `skipped`.
   - Else, decide source:
     - `flightDate >= today`: `await lookupFlight(...)` → use API result (with CSV fallback for null fields) and set `rawApiResponse`, `apiLastFetchedAt`, `lookupSchemaVersion` like the existing POST path.
     - `flightDate < today`: use CSV values as-is.
   - Insert. Catch unique-violation as `skipped` (race against the prefetched set), other errors as `failed` (push to `issues`).
5. Return counts.

Inserts are sequential per row to keep error attribution simple. For a Flighty export of a few hundred rows this is acceptable; if it becomes a problem we batch later.

### `app/components/ImportFlightyModal.vue` (new)

Modeled on `AddActivityModal.vue` and `EditTripModal.vue`. Three internal states:

- **picker** — file input, drag/drop optional but not required for v1.
- **previewing** — table of `preview` rows + counts + issues. Buttons: **Cancel**, **Import N flights** (disabled if `importableCount === 0`).
- **result** — `Imported X · Skipped Y · Failed Z`, plus issues list if any. Button: **Close**.

Emits `imported` event when at least one row was inserted; the parent calls `refresh()` on the flights list.

### `app/pages/flights.vue` (edit)

- Import a new `ImportFlightyModal` ref.
- Add a small **Import from Flighty** button beside / below the **Add Flight** submit. Mobile: stacks below.
- On the modal's `imported` event → `await refresh()`.

No other UI changes. Existing add / link-trip / delete / pagination logic untouched.

## Error handling

| Failure                                       | Behavior                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| File > size cap                               | Reject pre-parse: "File too large."                                    |
| Header doesn't match Flighty's format         | Reject parse: "This doesn't look like a Flighty export."               |
| Per-row parse error (bad date, missing field) | Skip row, surface in `issues`; other rows continue.                    |
| AeroDataBox lookup returns null (future row)  | Silent fall-through to CSV data — same as today's manual add behavior. |
| Unique violation at insert (race)             | Count as `skipped`, no user-visible error.                             |
| Other DB error at insert                      | Count as `failed`, surface line + reason in `issues`.                  |
| No CSV file in request                        | 400.                                                                   |
| Unauthenticated                               | 401 from `requireAuth`.                                                |

## Testing (TDD)

### `server/lib/flighty-import.test.ts` (new)

- Header validation: missing required column → throws `FlightyImportError`.
- Happy path on `FlightyExport-2026-05-23.csv` fixture: returns expected row count, no errors.
- `flightNumber` is `${Airline}${Flight}`.
- Time precedence: actual time wins over scheduled when both present; scheduled used when actual is empty.
- Status derivation: `Canceled=true` → `cancelled`; date < today → `landed`; date >= today → `scheduled`.
- Empty/whitespace rows in the middle of the file are skipped, don't break parsing.

### `server/api/flights/import/preview.post.test.ts` (new) — integration

- Returns counts matching the parser.
- `duplicateCount` reflects flights already in DB for that user.
- 401 when unauthenticated.

### `server/api/flights/import.post.test.ts` (new) — integration

- Imports past-dated rows from CSV (no API call assertion needed — `AERODATABOX_API_KEY` unset in test env, so `lookupFlight` returns null and CSV path is exercised).
- Does not import future-dated rows when lookup returns null but still falls back to CSV — verify row is inserted with CSV values.
- Duplicates are skipped.
- Two users' imports don't collide (one user's existing flight doesn't block another's import).

Reuse existing test infrastructure (`server/test-setup.ts`).

## Open considerations (acceptable defaults chosen)

- **PNR / seat preservation** — explicitly out of scope per the user's direction; this is a planner, not a tracker.
- **Re-export idempotency over time** — same CSV imported twice = zero new rows the second time (dedupe handles it). If the user re-exports months later with new flights, only the new ones land.
- **Cancelled-but-future flights** — keep status `"cancelled"` regardless of date; cancellation is more informative than scheduled.
- **Diverted flights** — `Diverted To` is dropped. Status stays whatever the past/future rule produces; we don't introduce a `"diverted"` status to avoid expanding the existing status vocabulary.
