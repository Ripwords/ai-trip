<p align="center">
  <img src=".github/assets/banner.png" alt="AI Trip — structured AI itineraries where every place is verified against Google Maps" width="100%" />
</p>

<h1 align="center">AI Trip</h1>

<p align="center">
  <strong>An AI travel planner that builds structured, editable itineraries — where every place is verified against Google Maps instead of invented by a language model.</strong>
</p>

<p align="center">
  <a href="https://www.plantrip.my"><img alt="Live demo" src="https://img.shields.io/badge/demo-plantrip.my-d44425?style=flat-square" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3d3328?style=flat-square" /></a>
  <img alt="Nuxt 4" src="https://img.shields.io/badge/Nuxt-4-00DC82?style=flat-square&logo=nuxtdotjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Bun" src="https://img.shields.io/badge/Bun-runtime-000000?style=flat-square&logo=bun&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/Postgres-Drizzle-4169E1?style=flat-square&logo=postgresql&logoColor=white" />
  <a href="https://vercel.com"><img alt="Deployed on Vercel" src="https://img.shields.io/badge/deploy-Vercel-000000?style=flat-square&logo=vercel&logoColor=white" /></a>
</p>

<p align="center">
  <a href="#why-this-exists">Why</a> ·
  <a href="#features">Features</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#ai-pipeline">AI Pipeline</a> ·
  <a href="#api-reference">API Reference</a> ·
  <a href="#security">Security</a>
</p>

---

## Why this exists

Ask a chatbot to plan a trip and it will happily invent a restaurant that closed in 2019, put a museum on the wrong side of the city, and schedule two hours of walking between lunch and a 14:00 reservation. The output looks great and falls apart the moment you try to use it.

AI Trip inverts that. The model is only allowed to **propose candidates**; everything a traveller actually sees is resolved through Google Places first:

```
User prompt → sanitize → classify intent → generate candidates
            → resolve via Google Places → enrich (lat/lng, hours, rating, photos)
            → schedule against real travel times → persist as structured JSON
```

The result is a **JSON-driven itinerary** you can drag, edit, split costs on, and share — not a wall of chat text. Every activity carries a real `place_id`, real coordinates, and real opening hours.

**Live at [plantrip.my](https://www.plantrip.my).**

## Features

### Trip planning

- **Intent-based AI planning** — natural language commands are classified into structured operations (add, remove, modify, reschedule, optimize, fill gaps, accommodation) rather than free-form chat
- **Google Maps enrichment** — every activity carries verified coordinates, ratings, photos, price level, and opening hours
- **Streaming discuss mode** — talk through a plan with the AI and accept proposals individually, with live SSE streaming
- **Trip-level generation** — generate a whole multi-day itinerary in one pass, then refine day by day
- **Drag-and-drop reordering** — rearrange activities with automatic travel-time recalculation
- **Route optimization** — reorder a day to minimize travel using the Distance Matrix API
- **Ideas bucket** — park places you're considering, promote them into the itinerary when ready

### Collaboration

- **Team trips** — invite members as owner, editor, or viewer, enforced on every request
- **Activity voting** — +1 / −1 on proposed activities
- **Inline comments** — discuss individual activities
- **Participant tracking** — mark who is attending what
- **Audit trail** — every trip mutation logged with actor, action, and metadata
- **Shareable links** — public read-only itinerary view via share token

### Travel documents

- **Passport manager** — AES-256-GCM encrypted at rest, with expiry and recommended-renewal dates
- **Visa checker** — requirement lookup by passport nationality and destination
- **Flight tracking** — AeroDataBox integration, layover detection, Flighty CSV import
- **Reservations** — hotels, flights, and car rentals with encrypted confirmation numbers
- **Packing checklists** — reusable templates with categories

### Money

- **Expense tracking** — per activity or per day
- **Custom splits** — who paid, who owes
- **Receipt attachments** — bounded uploads behind a pluggable storage interface
- **Currency conversion** — live exchange rates
- **CSV export** — for reporting or reimbursement

### Visualizations

- **Interactive maps** — day-by-day route rendering
- **3D globe** — visited countries and flight paths (Three.js via TresJS)
- **Scratch map** — travel history with layover-aware country detection
- **Dashboard stats** — trip counts, upcoming flights, distance travelled

### Progressive Web App

Installable on iOS and Android, offline-capable via service worker, with periodic background sync.

## Tech Stack

| Layer            | Technology                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Framework**    | [Nuxt 4](https://nuxt.com) (Vue 3, Nitro server)                                                                               |
| **Language**     | TypeScript (strict; no `any`)                                                                                                  |
| **Auth**         | [BetterAuth](https://better-auth.com) — Google OAuth, session management                                                        |
| **Database**     | [Drizzle ORM](https://orm.drizzle.team) + [Neon PostgreSQL](https://neon.tech)                                                 |
| **AI**           | [Vercel AI SDK](https://sdk.vercel.ai) calling [DeepSeek](https://deepseek.com) V4 Flash and [Google Gemini](https://ai.google.dev) |
| **Maps**         | [Google Maps Platform](https://developers.google.com/maps) — Places, Distance Matrix, Geocoding                                |
| **3D**           | [TresJS](https://tresjs.org) (Three.js for Vue)                                                                                |
| **Cache / KV**   | [Upstash Redis](https://upstash.com) as the Nitro storage driver                                                               |
| **Email**        | [Resend](https://resend.com)                                                                                                   |
| **Flights**      | [AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) via RapidAPI                                                    |
| **Styling**      | [Tailwind CSS 4](https://tailwindcss.com) with a custom sand/terra design system                                               |
| **Validation**   | [Zod 4](https://zod.dev)                                                                                                       |
| **Tooling**      | [oxlint](https://oxc.rs) + [oxfmt](https://oxc.rs), [Bun](https://bun.sh) runtime and test runner                              |
| **Deployment**   | [Vercel](https://vercel.com)                                                                                                   |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- A PostgreSQL database — [Neon](https://neon.tech) in production, or the bundled Docker Compose setup locally
- A Google Cloud project with **Places API (New)**, **Distance Matrix API**, **Geocoding API**, and OAuth 2.0 credentials
- A [Google AI Studio](https://aistudio.google.com) key (Gemini) — required
- A [DeepSeek](https://platform.deepseek.com) key — optional; the app falls back to Gemini 3.5 Flash without it
- A [Resend](https://resend.com) key for invite and reminder emails

### Setup

**1. Clone and install**

```bash
git clone https://github.com/Ripwords/ai-trip.git
cd ai-trip
bun install
```

**2. Configure environment**

```bash
cp .env.example .env
```

```bash
# Database — Neon, or the local Docker Postgres
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=verify-full
DATABASE_URL_UNPOOLED=postgresql://user:pass@ep-xxx.region.aws.neon.tech/db?sslmode=verify-full

# Auth
BETTER_AUTH_SECRET=              # openssl rand -base64 32
NUXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# AI
GOOGLE_GENERATIVE_AI_API_KEY=your-gemini-api-key
DEEPSEEK_API_KEY=               # optional — falls back to Gemini 3.5 Flash

# Maps — public key is referer-restricted, private key is IP-restricted
NUXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-browser-maps-key
NUXT_PRIVATE_GOOGLE_MAPS_API_KEY=your-server-maps-key

# Email
RESEND_API_KEY=re_xxxxx
RESEND_FROM_EMAIL=AI Trip <noreply@yourdomain.com>

# Encryption for passports and confirmation numbers
ENCRYPTION_KEY=                  # openssl rand -base64 32

# Optional
AERODATABOX_API_KEY=             # RapidAPI free tier, ~600 calls/month
RECEIPT_STORAGE_DRIVER=database  # database | memory
```

**3. Set up the database**

```bash
bun run docker:dev    # optional — local Postgres via Docker Compose
bun run db:gen        # generate Drizzle schema + BetterAuth tables
bun run db:push       # push schema to the database
```

**4. Run it**

```bash
bun run dev           # http://localhost:3000
```

### Scripts

| Command                | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `bun run dev`          | Dev server with HMR                            |
| `bun run build`        | Production build                               |
| `bun run preview`      | Preview the production build                   |
| `bun test`             | Run the test suite (86 test files)             |
| `bun run check`        | Format check + lint                            |
| `bun run fix`          | Autofix lint, then format                      |
| `bun run db:gen`       | Generate Drizzle schema + BetterAuth tables    |
| `bun run db:push`      | Push schema changes                            |
| `bun run db:migrate`   | Run migrations                                 |
| `bun run db:seed-test` | Seed test data                                 |
| `bun run docker:dev`   | Start local Postgres                           |

> **Note:** `drizzle-kit` loads `.env` itself and overrides inline shell variables, so `DATABASE_URL=... bun run db:migrate` will **not** retarget the database the way you expect. Edit `.env` instead.

## Architecture

```
ai-trip/
├── app/                        # Nuxt client
│   ├── components/             # 48 Vue components
│   ├── composables/            # 31 composables (maps, exports, theme, motion…)
│   ├── layouts/                # App shells
│   ├── middleware/             # Auth route guard
│   ├── pages/                  # 10 route pages
│   ├── plugins/                # Nuxt plugins
│   └── lib/                    # Auth client
│
├── server/                     # Nitro backend
│   ├── api/                    # ~108 route handlers
│   ├── db/
│   │   ├── schema/             # 32 Drizzle tables
│   │   └── migrations/         # Drizzle migrations
│   ├── lib/
│   │   ├── ai.ts               # Intent classification + generation
│   │   ├── ai-config.ts        # Model registry & provider routing
│   │   ├── ai-tools.ts         # Tool definitions for the planner
│   │   ├── enrich.ts           # Google Places enrichment
│   │   ├── google-maps.ts      # Places / Distance Matrix wrapper
│   │   ├── segments.ts         # Travel-time computation
│   │   ├── encryption.ts       # AES-256-GCM
│   │   ├── receipt-storage.ts  # Pluggable receipt storage
│   │   └── auth.ts             # BetterAuth configuration
│   ├── utils/                  # Auth helpers, rate limiting, validation
│   └── tasks/                  # Scheduled cron tasks
│
├── shared/                     # Types shared across client and server
├── docs/                       # Design specs and implementation plans
├── docker/                     # Local Postgres compose file
└── public/                     # Static assets, PWA icons, 3D models
```

### Database domains

32 tables, grouped by concern:

| Domain            | Tables                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| **Auth**          | `user`, `session`, `account`, `verification`                                                        |
| **Trips**         | `trips`, `itinerary_days`, `activities`, `travel_segments`, `trip_ideas`, `stays`                   |
| **Collaboration** | `trip_members`, `activity_log`, `activity_votes`, `activity_comments`, `activity_participants`      |
| **AI**            | `ai_usage`, `trip_chat_messages`, `trip_generation_runs`                                            |
| **Planning**      | `checklists`, `checklist_items`, `reservations`, `packing_templates`                                |
| **Money**         | `expenses`, `expense_attachments`                                                                   |
| **Profile**       | `user_profiles`, `user_passports`, `visited_countries`                                              |
| **Reference**     | `visa_requirements`, `flights`, `flight_api_cache`                                                  |

## AI Pipeline

AI Trip is an **intent engine**, not a chatbot. A natural language request is classified into a structured operation, and each operation has a deterministic handler.

### Intent types

| Intent          | Example                          | What happens                                            |
| --------------- | -------------------------------- | ------------------------------------------------------- |
| `add`           | "Add a ramen shop near Shibuya"  | Grounded search → generate candidate → Places enrichment |
| `remove`        | "Remove the castle visit"        | Name-match → delete activity                            |
| `modify`        | "Change the restaurant to sushi" | Replace activity with a new resolved place              |
| `reschedule`    | "Move dinner earlier"            | Recompute schedule respecting opening hours             |
| `optimize`      | "Minimize walking time"          | Reorder using Distance Matrix travel times              |
| `fill_gaps`     | "Fill the empty afternoon"       | Generate activities for open time slots                 |
| `accommodation` | "Find a hotel near the station"  | Search and set the day's accommodation                  |
| `general`       | Mixed or unclear requests        | Best-effort interpretation                              |

### Model routing

Models are registered per handler in `server/lib/ai-config.ts`, so any handler can be re-pointed without touching business logic:

| Key        | Model                    | Why                                                                       |
| ---------- | ------------------------ | ------------------------------------------------------------------------- |
| `default`  | DeepSeek V4 Flash        | Main generation path                                                      |
| `discuss`  | DeepSeek V4 Flash        | Streaming chat with tool round-trips                                      |
| `research` | Gemini 3.1 Flash Lite    | Google Search grounding is Gemini-only                                    |
| `classify` | Gemini 3.1 Flash Lite    | Cheap, fast intent classification                                         |

DeepSeek V4 defaults to a hidden *thinking* phase that hurts latency and tool round-trips, so it is explicitly disabled; opting in runs at `reasoningEffort: "low"` to fit the 60s function ceiling. Without `DEEPSEEK_API_KEY`, DeepSeek-routed keys fall back to Gemini 3.5 Flash.

### Schedule rules

The planner enforces schedules a human could actually walk:

- Activities constrained to 07:00–22:00
- Meal windows — breakfast 07:30–09:30, lunch 11:30–14:00, dinner 18:00–21:00
- 30-minute buffer between activities
- Venue opening hours respected
- Cross-day deduplication, so the same place is never suggested twice

### Rate limits

Each user gets **100 AI prompts per month**, metered atomically. Streaming turns are billed per step and settled non-idempotently at the end of the stream.

## API Reference

### Trips

| Method   | Endpoint               | Description                                 |
| -------- | ---------------------- | ------------------------------------------- |
| `GET`    | `/api/trips`           | List the user's trips                       |
| `POST`   | `/api/trips`           | Create a trip (auto-generates itinerary days) |
| `GET`    | `/api/trips/:id`       | Trip details                                |
| `PUT`    | `/api/trips/:id`       | Update a trip                               |
| `DELETE` | `/api/trips/:id`       | Delete a trip                               |
| `POST`   | `/api/trips/:id/share` | Generate a share token                      |

### Itinerary

| Method | Endpoint                                   | Description             |
| ------ | ------------------------------------------ | ----------------------- |
| `POST` | `/api/trips/:id/days/:dayId/ai`            | AI itinerary generation |
| `PUT`  | `/api/trips/:id/days/:dayId/reorder`       | Reorder activities      |
| `PUT`  | `/api/trips/:id/days/:dayId/accommodation` | Set accommodation       |
| `POST` | `/api/trips/:id/days/:dayId/restore`       | Undo day changes        |
| `GET`  | `/api/trips/:id/days/:dayId/segments`      | Travel segments         |

### Activities

| Method     | Endpoint                                         | Description       |
| ---------- | ------------------------------------------------ | ----------------- |
| `POST`     | `/api/trips/:id/activities`                      | Add an activity   |
| `PUT`      | `/api/trips/:id/activities/:activityId`          | Update an activity |
| `DELETE`   | `/api/trips/:id/activities`                      | Remove an activity |
| `POST`     | `/api/trips/:id/activities/:activityId/vote`     | Vote              |
| `GET/POST` | `/api/trips/:id/activities/:activityId/comments` | Comments          |

### Members

| Method   | Endpoint                           | Description   |
| -------- | ---------------------------------- | ------------- |
| `GET`    | `/api/trips/:id/members`           | List members  |
| `POST`   | `/api/trips/:id/members`           | Invite member |
| `PUT`    | `/api/trips/:id/members/:memberId` | Update role   |
| `DELETE` | `/api/trips/:id/members/:memberId` | Remove member |

### Places

| Method | Endpoint                       | Description          |
| ------ | ------------------------------ | -------------------- |
| `GET`  | `/api/places/search`           | Search Google Places |
| `GET`  | `/api/places/:placeId/details` | Place details        |

### Travel documents

| Method     | Endpoint                      | Description             |
| ---------- | ----------------------------- | ----------------------- |
| `GET/POST` | `/api/user/passports`         | Manage passports        |
| `GET`      | `/api/visa/check`             | Check visa requirements |
| `GET/POST` | `/api/flights`                | Manage flights          |
| `POST`     | `/api/flights/import`         | Import a Flighty CSV    |
| `GET/POST` | `/api/trips/:id/reservations` | Manage reservations     |

### Other

| Method     | Endpoint                 | Description                 |
| ---------- | ------------------------ | --------------------------- |
| `GET`      | `/api/ai/usage`          | AI prompt quota remaining   |
| `POST`     | `/api/ai/layover-tips`   | Layover recommendations     |
| `GET`      | `/api/stats`             | Dashboard statistics        |
| `GET`      | `/api/exchange-rate`     | Currency conversion         |
| `GET/POST` | `/api/visited-countries` | Travel history              |

## Security

- **Encryption at rest** — passport numbers and reservation confirmation numbers are AES-256-GCM encrypted
- **Sessions** — httpOnly cookies, 30-day expiry, JWE-cached session lookups
- **Rate limiting** — global 300 req/60s, with tighter per-route buckets; auth endpoints are bucketed separately so shared limits cannot cause spurious logouts
- **Content Security Policy** — nonce-based, via `nuxt-security`
- **Prompt sanitization** — user input is sanitized before reaching any model
- **Access control** — owner/editor/viewer roles checked on every trip-scoped request
- **Audit logging** — every mutation recorded with actor, action, and metadata

## Scheduled Tasks

| Schedule                | Task                  | Description                             |
| ----------------------- | --------------------- | --------------------------------------- |
| Jan 1 & Jul 1, 03:00    | Visa data import      | Refresh cached visa requirements        |
| Daily, 09:00            | Passport expiry check | Email reminders for expiring passports  |

## Contributing

Issues and pull requests are welcome. A few house rules:

- **Conventional Commits** — `feat:`, `fix:`, `chore:`, and friends
- **Tests first** — this project follows TDD; `bun test` should pass before you open a PR
- **Strict TypeScript** — no `any`, no `as unknown as X` unless genuinely unavoidable
- **Run `bun run check`** before pushing, and `bun run build` for anything touching Vue templates — typecheck alone does not catch template compile errors

Design specs and implementation plans for shipped features live in [`docs/`](docs/).

## License

[MIT](LICENSE) © Teoh Jia Jing
