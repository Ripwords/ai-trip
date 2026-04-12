# Trip Flights: 3D Globe + Connecting Flight Layover Detection

## Overview

Enhance the trip flights tab with two features:

1. **3D interactive globe** — hero section showing all flight paths for the trip on a satellite night-view styled globe
2. **Connecting flight detection** — automatically detect layovers between consecutive flights at the same airport, showing duration, visa status, and AI-powered exploration recommendations

## Globe Visualization

### Visual Style: Satellite Night View

- Dark ocean base with land masses rendered from TopoJSON country polygons
- Subtle terrain texture via multi-shade fills on land
- Faint coastline glow (slightly brighter border on land edges)
- Thin atmosphere rim light on the sphere edge (blue-tinted fresnel shader)
- Flight arcs in terra color (`#e8956a`) with glow effect
- Airport dots at departure/arrival points with subtle pulse
- IATA labels visible on hover
- Summary text below globe: "3 flights · 2 countries"

### Technical Approach

- **TresJS** (`@tresjs/core`) as the Vue-native Three.js wrapper
- **@tresjs/cientos** for OrbitControls (drag-to-rotate interaction)
- Globe is a `SphereGeometry` with dark material for ocean
- Country borders rendered from TopoJSON → GeoJSON, projected onto sphere surface using `d3-geo` (already in project) to convert lat/lng to 3D coordinates
- Land polygons as separate mesh with muted earth-tone material
- Flight paths as `QuadraticBezierCurve3` arcs (elevated above surface) rendered with `TubeGeometry` or `Line2`
- Slow auto-rotation, pauses on user interaction
- Airport positions looked up from static coordinate dataset

### Layout

- Hero position at top of flights tab, above the add-flight form
- Fixed height container (~300px) with the globe centered
- Responsive: same layout on mobile, globe scales down

### Airport Coordinates

New static dataset: `app/utils/airport-coordinates.ts`

```ts
export const airportCoordinates: Record<string, { lat: number; lng: number }> = {
  SIN: { lat: 1.3644, lng: 103.9915 },
  NRT: { lat: 35.772, lng: 140.3929 },
  // ~200 airports matching existing IATA mapping
}
```

Used to:

- Plot airport dots on the globe
- Calculate arc midpoints for flight path curves
- Convert lat/lng to 3D sphere coordinates via: `x = r * cos(lat) * cos(lng)`, `y = r * sin(lat)`, `z = r * cos(lat) * sin(lng)`

## Connecting Flight Detection

### Detection Algorithm

1. Sort trip flights by `flightDate` (ascending) then `departureTime` (ascending, nulls last) — reuses the existing `sortedTripFlights` computed
2. Iterate consecutive pairs `(flightA, flightB)` in sorted order
3. A connection is detected when:
   - `flightA.arrivalAirport === flightB.departureAirport` (same transfer airport)
   - `flightB.departureTime - flightA.arrivalTime <= 24 hours` (within layover window)
   - Both `arrivalTime` and `departureTime` are non-null (otherwise: show "Connection detected" without duration)

### Layover Duration Calculation

```ts
const durationMs =
  new Date(flightB.departureTime).getTime() - new Date(flightA.arrivalTime).getTime()
const durationMinutes = Math.round(durationMs / 60000)
```

### Recommendation Thresholds

| Duration  | Badge  | Label                | Rationale                                             |
| --------- | ------ | -------------------- | ----------------------------------------------------- |
| < 3 hours | Orange | "Stay in airport"    | Not enough time for immigration + travel to city      |
| 3–6 hours | Yellow | "Tight but possible" | Could explore if visa-free and airport well-connected |
| 6+ hours  | Green  | "Go explore!"        | Plenty of time to visit the city                      |

### Layover Card UI

Rendered between connecting FlightCards in the flights list. Dashed border to visually distinguish from flight cards.

Shows:

- Clock icon
- Duration text: "13h 10m layover at NRT"
- Visa status badge for the layover country (reuses existing `VisaBadge` / visa check API)
- Recommendation badge based on thresholds
- "AI tips" button (right-aligned) — expands to show AI-generated suggestions

### Edge Cases

- **Missing time data**: If `arrivalTime` or `departureTime` is null, show "Connection detected at {airport}" without duration or recommendation
- **Overnight layovers**: Duration calculation is purely time-based; AI tips endpoint can factor in airport operating hours
- **Multiple connections**: Each consecutive pair is evaluated independently — a trip with 4 flights could have up to 3 layover cards

## AI Layover Tips

### API Endpoint

`POST /api/ai/layover-tips`

**Request body:**

```ts
{
  airport: string // IATA code, e.g. "NRT"
  durationMinutes: number // layover duration
  visaStatus: string // "visa-free", "visa-required", etc.
  arrivalTime: string // ISO timestamp — for time-of-day context
}
```

**Response:**

```ts
{
  recommendation: string   // e.g. "You have plenty of time to explore Tokyo"
  suggestions: string[]    // specific things to do
  transitInfo: string      // how to get to/from airport
  returnBy: string         // when to head back to airport
}
```

**Implementation:**

- Uses Gemini (like existing visa details endpoint) with Google Search tool for current info
- Cached with Nitro `cachedFunction` keyed on `airport + durationMinutes (rounded to nearest hour) + visaStatus`
- Respects existing AI usage limits (`/api/ai/usage`)

### Frontend Integration

- `LayoverCard.vue` shows an "AI tips" button
- On click, fetches from `/api/ai/layover-tips` and expands an inline section (`LayoverAiTips.vue`)
- Loading state while fetching, error handling if AI quota exceeded

## New Components

### `FlightGlobe.vue`

- **Props**: `flights` (array of flight objects from trip flights API)
- **Behavior**: Extracts unique airports, looks up coordinates, renders globe with arcs
- **Dependencies**: `@tresjs/core`, `@tresjs/cientos`, `d3-geo`, `topojson-client`

### `LayoverCard.vue`

- **Props**: `arrivalFlight`, `departureFlight` (the two connecting flights)
- **Computed**: duration, layover airport, recommendation tier
- **Fetches**: visa status for layover country via existing `/api/visa/check`
- **Contains**: `LayoverAiTips.vue` as expandable child

### `LayoverAiTips.vue`

- **Props**: `airport`, `durationMinutes`, `visaStatus`, `arrivalTime`
- **Behavior**: Fetches AI tips on mount (or on explicit button click from parent), displays structured response

## Dependencies to Install

- `@tresjs/core` — Vue Three.js renderer
- `@tresjs/cientos` — OrbitControls, helpers

## Integration Points

### `app/pages/trips/[id].vue` — Flights Tab

1. Import and render `FlightGlobe` above the add-flight form, passing `sortedTripFlights`
2. Replace flat `v-for` of FlightCards with a loop that inserts `LayoverCard` between connecting pairs
3. Connecting pairs computed from `sortedTripFlights` using the detection algorithm

### Existing code reuse

- `iataToCountry` mapping — used by LayoverCard to resolve layover airport → country for visa check
- `VisaBadge` component — reused inside LayoverCard
- Visa check API (`/api/visa/check`) — called by LayoverCard for layover country
- AI infrastructure (Gemini, usage tracking, caching) — reused by layover tips endpoint
- `d3-geo` + `topojson-client` — already installed, reused for globe country rendering
