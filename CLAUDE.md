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
