# AI Travel Planner

## Stack

- **Frontend**: Nuxt (Vue)
- **Auth**: BetterAuth
- **Database**: Drizzle ORM (PostgreSQL / SQLite)
- **AI**: Google Gemini via AI SDK
- **Maps & Places**: Google Maps Platform (Places API, Distance Matrix, Geocoding)

## Core Philosophy

- JSON-driven itinerary engine, not chat-based responses
- All locations must be validated via Google Maps — AI must NEVER invent places blindly
- Map-first visualization
- Iterative AI updates with structured, editable outputs

## AI + Maps Pipeline

1. AI suggests candidate places (by name/type)
2. Backend resolves via Google Places API
3. Enrich with accurate lat/lng, ratings, metadata from Google

### Google Maps APIs

- **Places API**: Search locations, get name/coordinates/rating/price level/opening hours/photos
- **Distance Matrix API**: Travel time between locations (driving/walking/transit)
- **Geocoding API**: Convert place names to/from coordinates

### Enriched Location Object

```ts
interface EnrichedLocation {
  name: string
  place_id: string
  type: "attraction" | "restaurant" | "hotel" | "transport"
  description: string
  lat: number
  lng: number
  rating: number
  price_level: number
  address: string
  opening_hours: string[]
  photos: string[]
  estimated_duration_minutes: number
  suggested_time: string
  cost_estimate: number
  tags: string[]
}
```

## Conventions

- Follow conventions in the global CLAUDE.md (Conventional Commits, TDD, strict TypeScript)
- Nuxt fullstack project — use Nuxt server routes for backend logic
- Never output unstructured/chat-style itineraries — always use structured JSON
- Never hardcode or hallucinate location data — always validate against Google Maps

## MCP authorization server

`server/lib/auth.ts` registers `mcp()` from `@better-auth/mcp`, which turns this app into
an OAuth 2.1 authorization server for MCP clients. Three things about it will bite you.

**Client registration is open on purpose.** `allowDynamicClientRegistration` alone is not
enough: the provider authorizes a registration through one of three modes, and with only that
flag set the sole surviving mode is session-backed, which every standard MCP client fails —
they register before anyone has signed in, so they never reach the browser step that would
create the session. `allowUnauthenticatedClientRegistration: true` opens the third mode.
`clientPrivileges` is not the gate for this and never was; it is skipped entirely when there
is no session. Registering grants nothing on its own — a real user still passes `/sign-in`
and `/oauth/consent`, and the provider refuses `client_credentials` to an unauthenticated
registration — so the consent screen, not registration, is where a hostile client is stopped.

**Regenerating the auth schema needs a manual fix.** `bun run auth:gen` (and `db:gen`, which
calls it) still emits the OAuth tables correctly, but writes
`clientCredentialsScopes: text("client_credentials_scopes").array().default()` — a
`.default()` with no argument, which does not typecheck. Change it back to `.default([])`
after every regeneration. The pinned `@better-auth/cli` is 1.4.21 and there is no 1.7.x
release, so this is not fixable by upgrading yet.

**The app will not boot against a database missing migration 0044.** The oauth-provider's
`init` hook seeds a row into `oauth_resource`, and better-auth memoizes the auth context per
process. If that table is absent the whole context fails, so _every_ authenticated route
500s — including `/api/auth/get-session` — and it does not recover when the database
catches up, only on a process restart. Production is safe because `vercel-build` runs
`drizzle-kit migrate` first, but that step is skipped when `VERCEL_ENV` is not `production`,
so any preview pointed at an unmigrated database is fully broken rather than degraded.
