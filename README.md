<p align="center">
  <img src="public/pwa-192x192.png" alt="AI Trip" width="80" height="80" />
</p>

<h1 align="center">AI Trip</h1>

<p align="center">
  <strong>AI-powered travel itinerary planner with real places verified by Google Maps.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#ai-pipeline">AI Pipeline</a> ·
  <a href="#api-reference">API Reference</a>
</p>

---

## Overview

AI Trip is a full-stack travel planning application that combines structured AI itinerary generation with verified Google Maps data. Unlike chat-based travel assistants, AI Trip produces **editable, JSON-driven itineraries** where every location is validated against Google Places — no hallucinated restaurants, no invented addresses.

Plan trips collaboratively, track expenses, manage reservations, check visa requirements, and visualize your travel history on a 3D globe.

## Features

### Trip Planning

- **AI itinerary generation** — Intent-based planning (add, remove, optimize, reschedule, fill gaps) powered by Google Gemini
- **Google Maps enrichment** — Every activity verified with real coordinates, ratings, photos, and opening hours
- **Drag-and-drop reordering** — Rearrange activities with automatic travel time recalculation
- **Day-by-day editor** — Structured itinerary with time slots, accommodation, and notes
- **Route optimization** — Minimize travel time using Distance Matrix API
- **Ideas bucket** — Save places to consider, promote to itinerary when ready

### Collaboration

- **Team trips** — Invite members as owner, editor, or viewer
- **Activity voting** — +1/-1 voting on suggested activities
- **Comments** — Discuss activities inline
- **Participant tracking** — Mark who's attending each activity
- **Audit trail** — Full activity log of all changes
- **Shareable links** — Public read-only view via share token

### Travel Documents

- **Passport manager** — Encrypted storage (AES-256-GCM) with expiry reminders
- **Visa checker** — Requirement lookup by passport and destination
- **Flight tracking** — AeroDataBox integration with layover detection
- **Reservations** — Track hotels, flights, and car rentals with encrypted confirmation numbers
- **Document uploads** — Attach tickets, confirmations, and receipts
- **Packing checklists** — Reusable templates with categories

### Expense Management

- **Expense tracking** — Log costs per activity or day
- **Custom splits** — Track who paid and who owes
- **Currency conversion** — Real-time exchange rates
- **CSV export** — Export expenses for reporting

### Visualizations

- **Interactive maps** — Day-by-day route visualization
- **3D globe** — Visited countries and flight paths (Three.js)
- **Travel statistics** — Dashboard with trip stats and upcoming flights
- **Scratch map** — Track visited countries with layover detection

### Progressive Web App

- Installable on iOS and Android
- Offline-capable with service worker caching
- Periodic background sync

## Tech Stack

| Layer            | Technology                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| **Framework**    | [Nuxt 4](https://nuxt.com) (Vue 3, Nitro server)                                                                |
| **Auth**         | [BetterAuth](https://better-auth.com) (Google OAuth, session management)                                        |
| **Database**     | [Drizzle ORM](https://orm.drizzle.team) + [Neon PostgreSQL](https://neon.tech)                                  |
| **AI**           | [Google Gemini](https://ai.google.dev) via [Vercel AI SDK](https://sdk.vercel.ai) + [Mastra](https://mastra.ai) |
| **Maps**         | [Google Maps Platform](https://developers.google.com/maps) (Places, Distance Matrix, Geocoding)                 |
| **3D**           | [TresJS](https://tresjs.org) (Three.js for Vue)                                                                 |
| **File Storage** | [Vercel Blob](https://vercel.com/docs/storage/vercel-blob)                                                      |
| **Email**        | [Resend](https://resend.com)                                                                                    |
| **Flights**      | [AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) (RapidAPI)                                      |
| **Styling**      | [Tailwind CSS 4](https://tailwindcss.com)                                                                       |
| **Validation**   | [Zod 4](https://zod.dev)                                                                                        |
| **Linting**      | [oxlint](https://oxc.rs) + [oxfmt](https://oxc.rs)                                                              |
| **Runtime**      | [Bun](https://bun.sh)                                                                                           |
| **Deployment**   | [Vercel](https://vercel.com)                                                                                    |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- [Neon](https://neon.tech) PostgreSQL database (or any PostgreSQL instance)
- Google Cloud project with APIs enabled:
  - Places API (New)
  - Distance Matrix API
  - Geocoding API
  - OAuth 2.0 credentials
- [Google AI Studio](https://aistudio.google.com) API key (Gemini)
- [Resend](https://resend.com) API key (for invite emails)

### Setup

1. **Clone and install**

```bash
git clone https://github.com/your-username/ai-trip.git
cd ai-trip
bun install
```

2. **Configure environment**

```bash
cp .env.example .env
```

Fill in the required values:

```bash
# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=verify-full
DATABASE_URL_UNPOOLED=postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=verify-full

# Auth
BETTER_AUTH_SECRET=           # openssl rand -base64 32
NUXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000

# Google OAuth (Cloud Console → APIs & Services → Credentials)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# AI & Maps
GOOGLE_GENERATIVE_AI_API_KEY=your-gemini-api-key
NUXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-maps-api-key

# Email
RESEND_API_KEY=re_xxxxx
RESEND_FROM_EMAIL=AI Trip <noreply@yourdomain.com>

# Encryption (for passports & confirmation numbers)
ENCRYPTION_KEY=              # openssl rand -base64 32

# Optional: Flight tracking
AERODATABOX_API_KEY=         # RapidAPI free tier (~600 calls/month)
```

3. **Set up the database**

```bash
bun run db:gen        # Generate schema + auth tables
bun run db:push       # Push schema to database
```

4. **Start developing**

```bash
bun run dev           # http://localhost:3000
```

### Scripts

| Command                | Description                                 |
| ---------------------- | ------------------------------------------- |
| `bun run dev`          | Start dev server with HMR                   |
| `bun run build`        | Build for production                        |
| `bun run preview`      | Preview production build                    |
| `bun run db:gen`       | Generate Drizzle schema + BetterAuth tables |
| `bun run db:push`      | Push schema changes to database             |
| `bun run db:migrate`   | Run database migrations                     |
| `bun run db:seed-test` | Seed test data                              |
| `bun run lint`         | Run oxlint                                  |
| `bun run fmt`          | Format code with oxfmt                      |
| `bun run fix`          | Lint fix + format                           |

## Architecture

```
ai-trip/
├── app/                        # Nuxt client
│   ├── components/             # 44 Vue components
│   ├── composables/            # 12 composables (maps, exports, dark mode, etc.)
│   ├── layouts/                # App layouts
│   ├── middleware/             # Auth route guard
│   ├── pages/                  # 10 route pages
│   ├── plugins/                # Nuxt plugins
│   ├── utils/                  # Client utilities
│   └── lib/                    # Auth client
│
├── server/                     # Nitro backend
│   ├── api/                    # ~87 API route handlers
│   ├── db/
│   │   ├── schema/             # 23 Drizzle tables
│   │   └── migrations/         # Database migrations
│   ├── lib/                    # Core logic
│   │   ├── ai.ts               # AI engine (intent classification + generation)
│   │   ├── auth.ts             # BetterAuth configuration
│   │   ├── enrich.ts           # Google Places enrichment
│   │   ├── google-maps.ts      # Places API wrapper
│   │   ├── segments.ts         # Travel time computation
│   │   ├── encryption.ts       # AES-256-GCM encryption
│   │   └── email.ts            # Email templates (Resend)
│   ├── utils/                  # Auth helpers, rate limiting, validation
│   └── tasks/                  # Scheduled cron tasks
│
├── public/                     # Static assets
└── docker/                     # Docker configuration
```

### Database Schema

23 tables organized across these domains:

- **Auth** — `user`, `session`, `account`, `verification`
- **Trips** — `trips`, `itinerary_days`, `activities`, `travel_segments`, `trip_ideas`
- **Collaboration** — `trip_members`, `activity_log`, `activity_votes`, `activity_comments`, `activity_participants`
- **Planning** — `checklists`, `checklist_items`, `expenses`, `reservations`, `documents`, `packing_templates`
- **User Profile** — `user_profiles`, `user_passports`, `visited_countries`
- **Data** — `ai_usage`, `visa_requirements`, `flights`

## AI Pipeline

AI Trip uses an intent-based planning system — not a chatbot. Users issue natural language commands that are classified into structured operations.

### How It Works

```
User prompt → Sanitize → Classify intent → Execute handler → Enrich with Google Maps → Save
```

### Intent Types

| Intent          | Example                          | What happens                                           |
| --------------- | -------------------------------- | ------------------------------------------------------ |
| `add`           | "Add a ramen shop near Shibuya"  | Web search → generate activity → Places API enrichment |
| `remove`        | "Remove the castle visit"        | Name-match → delete activity                           |
| `modify`        | "Change the restaurant to sushi" | Replace activity with new search                       |
| `reschedule`    | "Move dinner earlier"            | Recompute schedule respecting opening hours            |
| `optimize`      | "Minimize walking time"          | Reorder using Distance Matrix travel times             |
| `fill_gaps`     | "Fill empty afternoon slots"     | Generate activities for open time slots                |
| `accommodation` | "Find a hotel near the station"  | Search and set day accommodation                       |
| `general`       | Mixed or unclear requests        | Best-effort interpretation                             |

### Schedule Rules

The AI enforces realistic scheduling:

- Activities between 07:00–22:00
- Meal windows: breakfast 07:30–09:30, lunch 11:30–14:00, dinner 18:00–21:00
- 30-minute buffer between activities
- Respects venue opening hours
- Cross-day deduplication (no repeated suggestions)

### Rate Limits

Each user gets **100 AI prompts per month**, tracked atomically to prevent over-usage.

## API Reference

### Trips

| Method   | Endpoint               | Description                                 |
| -------- | ---------------------- | ------------------------------------------- |
| `GET`    | `/api/trips`           | List user's trips                           |
| `POST`   | `/api/trips`           | Create trip (auto-generates itinerary days) |
| `GET`    | `/api/trips/:id`       | Get trip details                            |
| `PUT`    | `/api/trips/:id`       | Update trip                                 |
| `DELETE` | `/api/trips/:id`       | Delete trip                                 |
| `POST`   | `/api/trips/:id/share` | Generate share token                        |

### Itinerary

| Method | Endpoint                                   | Description             |
| ------ | ------------------------------------------ | ----------------------- |
| `POST` | `/api/trips/:id/days/:dayId/ai`            | AI itinerary generation |
| `PUT`  | `/api/trips/:id/days/:dayId/reorder`       | Reorder activities      |
| `PUT`  | `/api/trips/:id/days/:dayId/accommodation` | Set accommodation       |
| `POST` | `/api/trips/:id/days/:dayId/restore`       | Undo day changes        |
| `GET`  | `/api/trips/:id/days/:dayId/segments`      | Get travel segments     |

### Activities

| Method     | Endpoint                                         | Description       |
| ---------- | ------------------------------------------------ | ----------------- |
| `POST`     | `/api/trips/:id/activities`                      | Add activity      |
| `PUT`      | `/api/trips/:id/activities/:activityId`          | Update activity   |
| `DELETE`   | `/api/trips/:id/activities`                      | Remove activity   |
| `POST`     | `/api/trips/:id/activities/:activityId/vote`     | Vote on activity  |
| `GET/POST` | `/api/trips/:id/activities/:activityId/comments` | Activity comments |

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
| `GET`  | `/api/places/:placeId/details` | Get place details    |

### Travel Documents

| Method     | Endpoint                      | Description             |
| ---------- | ----------------------------- | ----------------------- |
| `GET/POST` | `/api/user/passports`         | Manage passports        |
| `GET`      | `/api/visa/check`             | Check visa requirements |
| `GET/POST` | `/api/flights`                | Manage flights          |
| `GET/POST` | `/api/trips/:id/reservations` | Manage reservations     |
| `POST`     | `/api/trips/:id/documents`    | Upload documents        |

### Other

| Method     | Endpoint                 | Description                 |
| ---------- | ------------------------ | --------------------------- |
| `GET`      | `/api/ai/usage`          | Check AI prompt usage       |
| `POST`     | `/api/ai/layover-tips`   | Get layover recommendations |
| `GET`      | `/api/stats`             | Dashboard statistics        |
| `GET`      | `/api/exchange-rate`     | Currency conversion         |
| `GET/POST` | `/api/visited-countries` | Travel history              |

## Security

- **Encryption** — Passport numbers and confirmation numbers encrypted with AES-256-GCM at rest
- **Auth** — Session-based with 30-day expiry, httpOnly cookies, JWE caching
- **Rate limiting** — Global (300 req/60s) with stricter limits on auth and sensitive endpoints
- **CSP** — Nonce-based Content Security Policy
- **Input sanitization** — AI prompts sanitized to prevent injection
- **Access control** — Role-based trip access (owner/editor/viewer) checked on every request
- **Audit logging** — All trip modifications logged with user, action, and metadata

## Scheduled Tasks

| Schedule               | Task                  | Description                            |
| ---------------------- | --------------------- | -------------------------------------- |
| Jan 1 & Jul 1, 3:00 AM | Visa data import      | Refresh cached visa requirements       |
| Daily, 9:00 AM         | Passport expiry check | Email reminders for expiring passports |

## License

Private project. All rights reserved.
