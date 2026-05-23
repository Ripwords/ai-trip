# Passport History Page

## Overview

Add a standalone `/passport` page that presents a user’s flight history and country history as a compact travel passport. The page should feel closer to an editorial travel ledger than a dense dashboard, while keeping the data minimal like Flighty’s passport view.

Approved visual direction:

- Editorial card structure with warm paper-like data panels
- A dark gradient shell similar to the pre-trip briefing card: warm charcoal/brown on the left, deep green-black on the right
- Minimal metrics: flights, flight distance, countries, airports, airlines
- Country flags shown once, inside the country-history card
- A simple route map as the main visual, not a full interactive globe

## Route And Navigation

Create a new page at `app/pages/passport.vue` using the existing `app` layout.

Navigation updates:

- Add a desktop nav link in `app/layouts/app.vue`
  - Label: `Passport`
  - Icon: `lucide:stamp` if available; fallback `lucide:book-open`
  - Route: `/passport`
- Add a mobile nav tab in `app/components/Nav/Mobile.vue`
  - Label: `Passport`
  - Same icon choice as desktop

The existing `/flights` page remains the management surface for adding, linking, and deleting flights.

## Data Sources

Use existing APIs for the first version:

- `/api/flights`
  - Source for flights, airlines, airports, routes, dates, and recent-flight list
  - Already returns the user’s flights without raw API response data
- `/api/visited-countries`
  - Source for manually tracked country history from the Explore page

No new backend endpoint is required for v1 unless implementation exposes a serious client-side performance issue.

## Derived Passport Model

Create a small frontend utility module at `app/utils/passport-history.ts` to keep page logic testable and out of the Vue template.

Inputs:

- Flights from `/api/flights`
- Visited-country records from `/api/visited-countries`
- Existing `airportCoordinates`
- Existing `iataToCountry`
- Existing `countryByAlpha2` and `countryFlag`

Outputs:

- `totalFlights`: count of all flights
- `totalDistanceKm`: sum of distances for flights where both airport coordinates are known
- `uniqueAirports`: unique non-empty departure and arrival airport codes
- `uniqueAirlines`: unique non-empty airline names
- `countries`: union of visited countries and flight-derived airport countries
- `countryFlags`: ordered flags derived from country alpha-2 codes
- `recentFlights`: latest completed or dated flights, capped to 3-5 items
- `routeSegments`: flights with known coordinates for rendering map lines

Country ordering:

1. Countries manually marked as `visited`
2. Countries manually marked as `layover`
3. Countries derived from flight airports only
4. Alphabetical by country name within each group

Manual visited-country data should win over flight-derived data. For example, if Japan is marked `visited` and also appears in flights, show it as visited.

## Distance Calculation

Use a standard haversine calculation from known airport coordinates.

Rules:

- Include only flights where both departure and arrival airport coordinates exist
- Round the final total to the nearest kilometer
- Do not block the page when coordinates are missing
- Surface missing coordinate coverage only implicitly by still counting the flight while omitting it from distance and route-line totals

## Visual Layout

The page uses a single primary passport panel, followed by compact supporting lists.

Top-level structure:

- Page header: `Travel Passport` with period filter/display
- Passport panel:
  - Dark gradient shell matching the approved briefing-card style
  - Left side: simple route map
  - Below/near map: large `Flights` and `Flight distance` metrics
  - Right side: compact country, airport, and airline metrics
  - Country card includes the one visible row/wrap of flags
- Lower section:
  - Country history list
  - Recent flights list

Gradient treatment:

- Use a restrained linear gradient close to `#33211d -> #1d2d2b -> #131815`
- Terra/orange accent for small uppercase labels and route emphasis
- Warm translucent paper panels for metric cards
- Avoid purple Flighty styling; this should feel native to AI Trip

Route map:

- Render as an inline SVG using the existing route segments
- Use a muted map/grid background rather than a fully detailed world map
- Draw route lines in terra/gold accents
- Draw small airport dots and optional airport-code labels
- Keep it decorative-informational, not a pan/zoom map

Responsive behavior:

- Desktop: map and metrics sit in a two-column panel
- Mobile: stack map first, then primary metrics, then country/airport/airline cards
- Text must not overflow metric cards; large numbers should use tabular numeric styling and responsive truncation where needed

## Filtering

Implement a simple period selector for the passport:

- `All-time`
- Year chips generated from available flight dates

The selected period filters:

- flights
- distance
- airports
- airlines
- flight-derived countries
- recent flights
- route segments

Visited countries from `/api/visited-countries` should remain visible in all-time mode. In a specific year view, show only flight-derived countries for that year because the visited-country API does not store visit dates.

## Empty And Loading States

Loading:

- Show a compact skeleton matching the passport panel proportions.

No flights and no countries:

- Show an empty passport panel with links to:
  - `/flights` to add flights
  - `/explore` to mark countries

Some data missing:

- If there are flights but no mappable routes, show metrics and lists without route lines.
- If there are countries but no flights, show the country card and history list with zeroed flight metrics.

## Error Handling

If `/api/flights` fails:

- Show a small inline error in the passport panel and keep any loaded country data visible.

If `/api/visited-countries` fails:

- Still render flight-derived countries and route data.

Both errors should be non-blocking and avoid full-page failure states.

## Testing

Add focused tests for the derived passport model utility:

- Counts flights, unique airports, and unique airlines
- Calculates distance only for flights with known coordinates
- Builds country history by combining visited countries with flight-derived countries
- Gives manually visited countries precedence over flight-derived countries
- Filters flight-derived stats by year

Run formatting/lint checks after implementation.

## Out Of Scope

- Editing flights on the passport page
- Persisting passport snapshots
- New backend aggregation endpoint
- Export/share image generation
- 3D globe or pan/zoom map interactions
