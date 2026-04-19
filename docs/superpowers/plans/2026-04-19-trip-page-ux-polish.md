# Trip Page UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "feels like a full refresh" flicker when adding activities, add a modal to edit trip dates (with destructive-confirmation when shrinking the range deletes activities), and move the "Add places" (IdeasBucket) block above Accommodation in the day column.

**Architecture:**
- Client-side: replace post-add `refresh()` with local merge of the POST response; add `EditTripModal.vue` that mirrors `AddActivityModal.vue` structure.
- Server-side: extend activity-create response to include recomputed segments; add a read-only `date-change-preview` endpoint; upgrade the trip PUT to transactionally reconcile `itineraryDays` when dates change.
- Extract two shared server helpers (`enumerateDates`, `getTripWithRelations`) so the existing trip-create route, the new preview route, and the upgraded PUT all use the same code.

**Tech Stack:** Nuxt 4 (Vue 3, composition API, `useLazyFetch`, `$fetch`), Drizzle ORM on PostgreSQL (neon-serverless), Zod v4, TailwindCSS, oxlint/oxfmt.

**Testing strategy:** This project has no Vitest config and no test runner in `package.json`. Per project CLAUDE.md, manual browser verification is the test contract for UI work; `bun run check` (oxfmt + oxlint) and the TypeScript type-check run by `bun run build` are the automated gates. Each task ends with an explicit manual/automated verification step. Tests are **not** added in this plan because adding test infra is scope creep beyond the stated goal — if you want a proper Vitest setup, that should be its own plan.

**Spec:** `docs/superpowers/specs/2026-04-19-trip-page-ux-polish-design.md`

---

## File structure

**New files:**
- `server/lib/dates.ts` — pure `enumerateDates(start: string, end: string): string[]` helper.
- `server/lib/trips.ts` — `getTripWithRelations(tripId: string)` helper returning the shape used by the GET endpoint.
- `server/api/trips/[id]/date-change-preview.get.ts` — read-only preview of day-level diff.
- `app/components/EditTripModal.vue` — modal for editing `destination`, `startDate`, `endDate` with destructive-confirmation flow.

**Modified files:**
- `server/utils/schemas.ts` — add `dateRangeQuerySchema`; add refine on `updateTripSchema`.
- `server/api/trips/[id]/activities/index.post.ts` — return `{ activity, segments }`.
- `server/api/trips/[id].put.ts` — transactional day reconciliation; return hydrated trip.
- `server/api/trips/[id].get.ts` — use shared `getTripWithRelations` helper.
- `server/api/trips/index.post.ts` — use shared `enumerateDates` helper.
- `app/components/AddActivityModal.vue` — emit `added` with payload.
- `app/pages/trips/[id].vue` — reorder day column; replace `handleActivityAdded`; wire `EditTripModal` and "Edit trip" more-menu item.

---

## Task 1: Reorder IdeasBucket above AccommodationSection

**Files:**
- Modify: `app/pages/trips/[id].vue:1181-1227`

- [ ] **Step 1: Move the IdeasBucket block above AccommodationSection**

Open `app/pages/trips/[id].vue`. Find the left column starting around line 1181 (the `<!-- Left: Accommodation + Activities + Ideas -->` comment).

Current order (inside `<div class="flex-1 space-y-6 ...">`):
1. `<!-- Accommodation ... -->` + `<AccommodationSection ... />`
2. `<!-- AI loading overlay -->` + `<AiLoadingOverlay ... />`
3. `<!-- Activities for this day -->` + `<DaySection ... />`
4. `<!-- Ideas bucket ... -->` + `<IdeasBucket ... />`

Cut the **entire** `<!-- Ideas bucket (hidden for viewers) -->` block including the comment and `<IdeasBucket ... />` element (including its `v-if`, `v-show`, all props, and `@refresh`). Paste it at the top of the left column, immediately after the opening `<div class="flex-1 space-y-6 ...">` div.

Also update the section header comment on the opening div from `<!-- Left: Accommodation + Activities + Ideas -->` to `<!-- Left: Ideas + Accommodation + Activities -->` to match the new order.

New order:
1. `<!-- Ideas bucket (hidden for viewers) -->` + `<IdeasBucket ... />`
2. `<!-- Accommodation (hidden for viewers) -->` + `<AccommodationSection ... />`
3. `<!-- AI loading overlay -->` + `<AiLoadingOverlay ... />`
4. `<!-- Activities for this day -->` + `<DaySection ... />`

Do not change any props, emits, classes, or guards. Move only.

- [ ] **Step 2: Run lint + format**

Run: `bun run check`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 3: Manual browser verification**

Run `bun run dev`. Open a trip with at least one day in the itinerary tab. Verify:
- "Places you'd like to visit" (IdeasBucket) renders directly under the day tabs, above the Accommodation block.
- Accommodation, activities list, and AI loading overlay still behave as before.
- Viewer role still does not see IdeasBucket or Accommodation.
- Mobile layout (below `lg:` breakpoint) still stacks the map above the left column (the `order-first` on the map container is untouched).

- [ ] **Step 4: Commit**

```bash
git add app/pages/trips/[id].vue
git commit -m "feat(trip): move IdeasBucket above Accommodation in day column"
```

---

## Task 2: Extract shared `enumerateDates` and `getTripWithRelations` helpers

**Files:**
- Create: `server/lib/dates.ts`
- Create: `server/lib/trips.ts`
- Modify: `server/api/trips/index.post.ts:32-59`
- Modify: `server/api/trips/[id].get.ts`

- [ ] **Step 1: Create `server/lib/dates.ts`**

```ts
/**
 * Return every ISO date string (YYYY-MM-DD) from `start` to `end` inclusive.
 * Both inputs must be valid YYYY-MM-DD strings. Caller enforces `end >= start`.
 */
export function enumerateDates(start: string, end: string): string[] {
  const out: string[] = []
  const startDate = new Date(`${start}T00:00:00Z`)
  const endDate = new Date(`${end}T00:00:00Z`)
  const cursor = new Date(startDate)
  while (cursor.getTime() <= endDate.getTime()) {
    out.push(cursor.toISOString().split("T")[0]!)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}
```

- [ ] **Step 2: Create `server/lib/trips.ts`**

```ts
import { eq } from "drizzle-orm"
import { db } from "../db"
import { trips } from "../db/schema"

/**
 * Fetch a trip with its full relational payload (days → activities + travelSegments).
 * Returns `undefined` if the trip does not exist. Shape matches `GET /api/trips/[id]`
 * so the client-side `TripResponse` type fits unchanged.
 */
export async function getTripWithRelations(tripId: string) {
  return db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    with: {
      days: {
        orderBy: (days, { asc }) => [asc(days.dayNumber)],
        with: {
          activities: {
            orderBy: (activities, { asc }) => [asc(activities.sortOrder)],
          },
          travelSegments: true,
        },
      },
    },
  })
}
```

- [ ] **Step 3: Refactor `server/api/trips/[id].get.ts` to use the helper**

Replace the full file content with:

```ts
import { uuidParamsSchema } from "../../utils/schemas"
import { getTripWithRelations } from "../../lib/trips"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const access = await requireTripAccess(id, session.user.id)

  const trip = await getTripWithRelations(id)
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  return { ...trip, _role: access.role }
})
```

- [ ] **Step 4: Refactor `server/api/trips/index.post.ts` to use `enumerateDates`**

Replace lines 32-59 (the block that manually constructs `dayValues` with `new Date` loops and the trailing `db.query.trips.findFirst`) with:

```ts
import { enumerateDates } from "../../lib/dates"
import { getTripWithRelations } from "../../lib/trips"
// (add these imports to the top of the file alongside the existing imports)

// ...inside the handler, after the trip insert...

const dayValues = enumerateDates(body.startDate, body.endDate).map((date, i) => ({
  tripId: trip!.id,
  dayNumber: i + 1,
  date,
}))

await db.insert(itineraryDays).values(dayValues)

return await getTripWithRelations(trip!.id)
```

Remove the now-unused `eq` import from this file if nothing else in the file references it.

- [ ] **Step 5: Type-check + lint**

Run: `bun run build`
Expected: build succeeds with no TypeScript errors.

Run: `bun run check`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 6: Manual regression check**

Run `bun run dev`. Create a new trip from `/trips/new` with a 3-day range. Verify:
- Trip is created, redirect lands on `/trips/:id`.
- Three itinerary days render with correct dates (same as before this refactor).
- Opening an existing trip still loads all days, activities, and travel segments.

- [ ] **Step 7: Commit**

```bash
git add server/lib/dates.ts server/lib/trips.ts server/api/trips/index.post.ts server/api/trips/[id].get.ts
git commit -m "refactor(server): extract enumerateDates and getTripWithRelations helpers"
```

---

## Task 3: Return segments from activity-create POST

**Files:**
- Modify: `server/api/trips/[id]/activities/index.post.ts`

- [ ] **Step 1: Update the endpoint to return both activity and segments**

Open `server/api/trips/[id]/activities/index.post.ts`. Add `travelSegments` to the schema imports at the top, and `asc` to the drizzle imports:

```ts
import { and, eq, desc, sql, asc } from "drizzle-orm"
import { db } from "../../../../db"
import { itineraryDays, activities, travelSegments } from "../../../../db/schema"
import { uuidParamsSchema, addActivitySchema } from "../../../../utils/schemas"
import { computeAndSaveSegments } from "../../../../lib/segments"
```

Replace the final `return activity` (line 65) block with a query for the day's segments followed by a combined return:

```ts
// Recompute segments
await computeAndSaveSegments(itineraryDayId)

// Audit log
await logTripAction({
  tripId: id,
  userId: session.user.id,
  action: "activity_added",
  description: `Added "${activity!.name}" to Day`,
})

const segments = await db.query.travelSegments.findMany({
  where: eq(travelSegments.itineraryDayId, itineraryDayId),
  orderBy: [asc(travelSegments.sortOrder)],
})

return { activity, segments }
```

If `travelSegments` doesn't have a `sortOrder` column, check `server/db/schema/travel-segments.ts` for the actual ordering column and swap it in. If there is no natural sort column, drop the `orderBy` clause — the client only needs the set; order within the day is derived from `fromActivityId` joining activities.

- [ ] **Step 2: Type-check + lint**

Run: `bun run build`
Expected: build succeeds.

Run: `bun run check`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 3: Manual verification (via DevTools Network)**

Run `bun run dev`. Open a trip, click "Add activity" on a day, search and add a place. In DevTools → Network → the POST to `/api/trips/.../activities`, verify the response body is now `{ activity: {...}, segments: [...] }` instead of just `{...}` (the activity object directly).

- [ ] **Step 4: Commit**

```bash
git add server/api/trips/[id]/activities/index.post.ts
git commit -m "feat(trip): return recomputed segments from activity POST"
```

---

## Task 4: Optimistic activity insert on the trip page

**Files:**
- Modify: `app/components/AddActivityModal.vue`
- Modify: `app/pages/trips/[id].vue`

- [ ] **Step 1: Update `AddActivityModal.vue` emit signature**

In `app/components/AddActivityModal.vue`, replace the emits declaration (lines 11-14) with:

```ts
const emit = defineEmits<{
  added: [payload: { activity: Record<string, unknown>; segments: unknown[]; dayId: string }]
  close: []
}>()
```

(The concrete types live in the trip page — the modal forwards the server response unchanged. Using `Record<string, unknown>` and `unknown[]` here avoids cross-file type duplication.)

In both `handleSearchSubmit` (lines 38-63) and `handleManualSubmit` (lines 65-86), replace:

```ts
await $fetch(`/api/trips/${props.tripId}/activities`, { method: "POST", body: {...} })
emit("added")
```

with:

```ts
const result = (await $fetch(`/api/trips/${props.tripId}/activities`, {
  method: "POST",
  body: { ...same body as before... },
})) as { activity: Record<string, unknown>; segments: unknown[] }

emit("added", { activity: result.activity, segments: result.segments, dayId: props.dayId })
```

Keep the existing `emit("close")` and `resetForm()` calls in place.

- [ ] **Step 2: Replace `handleActivityAdded` in the trip page**

Open `app/pages/trips/[id].vue`. Find the existing handler (lines 656-659):

```ts
async function handleActivityAdded() {
  // Server already recomputes segments on activity add, just refresh data
  await refresh()
}
```

Replace with:

```ts
function handleActivityAdded(payload: {
  activity: Record<string, unknown>
  segments: unknown[]
  dayId: string
}) {
  if (!trip.value) return
  const day = trip.value.days.find((d) => d.id === payload.dayId)
  if (!day) return
  day.activities = [...day.activities, payload.activity as TripActivity]
  day.travelSegments = payload.segments as TripDay["travelSegments"]
}
```

The `TripActivity` and `TripDay` types are already defined in this file at lines 131 and 152. The payload's wider types match the modal's emit signature (which can't import these local interfaces without a shared types module); the narrowing `as` casts are safe because the server is the source of truth for the payload shape. Per project CLAUDE.md, plain `as` is acceptable — only `as unknown as X` is discouraged.

- [ ] **Step 3: Verify the template binding already passes the payload through**

Find the `<AddActivityModal ... @added="handleActivityAdded" ... />` usage in the template (around line 1368). Vue forwards the emit arguments positionally to the handler — no template change needed as long as `handleActivityAdded`'s parameter signature matches the emit payload shape. Confirm by reading the template; no edit required.

- [ ] **Step 4: Type-check + lint**

Run: `bun run build`
Expected: build succeeds. If TypeScript complains that the `segments` shape from the modal (`unknown[]`) doesn't narrow to `TripDay["travelSegments"]`, cast at the call site — or refine the modal's emit payload to use the same fields (`fromActivityId`, `durationText`, `distanceText`). Prefer refining over casting.

Run: `bun run check`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 5: Manual browser verification**

Run `bun run dev`. Open a trip, pick a day with at least one activity already, click "Add activity", and add a place via search.

Verify:
- The new activity appears in the day's activity list immediately.
- The map marker for the new place appears.
- A travel segment divider renders between the previous activity and the new one (segments updated in place).
- **No loading flash** — nothing below the fold goes momentarily blank/skeleton.
- Add another activity — same smooth behavior.
- Refresh the page with `Cmd+R` — the activity persisted to the DB and still shows up.

- [ ] **Step 6: Commit**

```bash
git add app/components/AddActivityModal.vue app/pages/trips/[id].vue
git commit -m "feat(trip): optimistic activity insert without refetch"
```

---

## Task 5: Add `date-change-preview` endpoint + schema

**Files:**
- Modify: `server/utils/schemas.ts`
- Create: `server/api/trips/[id]/date-change-preview.get.ts`

- [ ] **Step 1: Add `dateRangeQuerySchema` + tighten `updateTripSchema`**

Open `server/utils/schemas.ts`. After the existing `updateTripSchema` block (lines 35-40), add:

```ts
export const dateRangeQuerySchema = z
  .object({
    startDate: z.string().date(),
    endDate: z.string().date(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be >= startDate",
    path: ["endDate"],
  })
```

Also wrap the existing `updateTripSchema` with a `.refine` to reject inverted ranges. Change:

```ts
export const updateTripSchema = createTripSchema.partial().extend({
  status: tripStatusEnum.optional(),
  budget: z.string().nullish(),
  currencyCode: z.string().length(3).optional(),
  tripNotes: z.string().nullish(),
})
```

to:

```ts
export const updateTripSchema = createTripSchema
  .partial()
  .extend({
    status: tripStatusEnum.optional(),
    budget: z.string().nullish(),
    currencyCode: z.string().length(3).optional(),
    tripNotes: z.string().nullish(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "endDate must be >= startDate",
    path: ["endDate"],
  })
```

- [ ] **Step 2: Create `server/api/trips/[id]/date-change-preview.get.ts`**

```ts
import { eq } from "drizzle-orm"
import { db } from "../../../../db"
import { itineraryDays } from "../../../../db/schema"
import { uuidParamsSchema, dateRangeQuerySchema } from "../../../../utils/schemas"
import { enumerateDates } from "../../../../lib/dates"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const { startDate, endDate } = await getValidatedQuery(event, dateRangeQuerySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const days = await db.query.itineraryDays.findMany({
    where: eq(itineraryDays.tripId, id),
    with: {
      activities: {
        columns: { id: true, name: true },
      },
    },
  })

  const outside = days.filter((d) => d.date < startDate || d.date > endDate)

  const targetDates = enumerateDates(startDate, endDate)
  const existingDates = new Set(days.map((d) => d.date))
  const daysToAdd = targetDates.filter((d) => !existingDates.has(d)).length

  return {
    daysToDelete: outside.map((d) => ({
      id: d.id,
      dayNumber: d.dayNumber,
      date: d.date,
      activityCount: d.activities.length,
      activityNames: d.activities.map((a) => a.name),
    })),
    daysToAdd,
  }
})
```

- [ ] **Step 3: Type-check + lint**

Run: `bun run build`
Expected: build succeeds.

Run: `bun run check`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 4: Manual endpoint smoke test**

Run `bun run dev`. Open DevTools Console on a trip page you own (e.g. `/trips/abc-123`) so the session cookie is sent. Run:

```js
await fetch(`/api/trips/${window.location.pathname.split("/").pop()}/date-change-preview?startDate=2026-05-01&endDate=2026-05-02`).then(r => r.json())
```

Verify the response shape: `{ daysToDelete: [...], daysToAdd: number }`. Run the query again with `endDate=startDate` → should succeed with `daysToDelete` likely non-empty. Run with `endDate < startDate` → should 400.

- [ ] **Step 5: Commit**

```bash
git add server/utils/schemas.ts server/api/trips/[id]/date-change-preview.get.ts
git commit -m "feat(trip): add date-change-preview endpoint and date-range validation"
```

---

## Task 6: Upgrade PUT `/api/trips/[id]` to reconcile days transactionally

**Files:**
- Modify: `server/api/trips/[id].put.ts`

- [ ] **Step 1: Rewrite the PUT endpoint**

Replace the full contents of `server/api/trips/[id].put.ts` with:

```ts
import { and, asc, eq, gt, lt, or } from "drizzle-orm"
import { db } from "../../db"
import { trips, itineraryDays } from "../../db/schema"
import { uuidParamsSchema, updateTripSchema } from "../../utils/schemas"
import { enumerateDates } from "../../lib/dates"
import { getTripWithRelations } from "../../lib/trips"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, updateTripSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  await db.transaction(async (tx) => {
    const existing = await tx.query.trips.findFirst({ where: eq(trips.id, id) })
    if (!existing) {
      throw createError({ statusCode: 404, message: "Trip not found" })
    }

    const datesChanging =
      (body.startDate !== undefined && body.startDate !== existing.startDate) ||
      (body.endDate !== undefined && body.endDate !== existing.endDate)

    await tx.update(trips).set(body).where(eq(trips.id, id))

    if (datesChanging) {
      const newStart = body.startDate ?? existing.startDate
      const newEnd = body.endDate ?? existing.endDate

      // 1. Delete out-of-range days. Activities cascade via FK.
      await tx
        .delete(itineraryDays)
        .where(
          and(
            eq(itineraryDays.tripId, id),
            or(lt(itineraryDays.date, newStart), gt(itineraryDays.date, newEnd)),
          ),
        )

      // 2. Insert missing days inside the new range.
      const remaining = await tx.query.itineraryDays.findMany({
        where: eq(itineraryDays.tripId, id),
        orderBy: [asc(itineraryDays.date)],
      })
      const remainingDates = new Set(remaining.map((d) => d.date))
      const toInsert = enumerateDates(newStart, newEnd)
        .filter((date) => !remainingDates.has(date))
        .map((date) => ({ tripId: id, date, dayNumber: 0 }))
      if (toInsert.length) {
        await tx.insert(itineraryDays).values(toInsert)
      }

      // 3. Renumber dayNumber by ascending date.
      const finalDays = await tx.query.itineraryDays.findMany({
        where: eq(itineraryDays.tripId, id),
        orderBy: [asc(itineraryDays.date)],
      })
      for (let i = 0; i < finalDays.length; i++) {
        await tx
          .update(itineraryDays)
          .set({ dayNumber: i + 1 })
          .where(eq(itineraryDays.id, finalDays[i]!.id))
      }
    }
  })

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "trip_updated",
    description: "Trip details updated",
  })

  const hydrated = await getTripWithRelations(id)
  if (!hydrated) {
    throw createError({ statusCode: 404, message: "Trip not found after update" })
  }
  return hydrated
})
```

Notes:
- `logTripAction` is already used by `activities/index.post.ts:58` — assume it's globally available via Nitro auto-imports, same pattern as `requireAuth` / `requireTripAccess`.
- The shape returned no longer matches the prior return (just the raw trip row). The caller in Task 8 merges the full hydrated response into `trip.value`, which matches `GET /api/trips/[id]`'s shape minus `_role`.

- [ ] **Step 2: Type-check + lint**

Run: `bun run build`
Expected: build succeeds.

Run: `bun run check`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 3: Manual endpoint smoke test**

Run `bun run dev`. Create a throwaway trip with a 5-day range (e.g. 2026-05-01 → 2026-05-05). Add one activity to Day 3. In DevTools Console on that trip page:

```js
// Shrink the range to a window that excludes Day 3
await fetch(`/api/trips/${window.location.pathname.split("/").pop()}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ startDate: "2026-05-01", endDate: "2026-05-02" }),
}).then(r => r.json())
```

Verify:
- Response has `days` array of length 2 with correct dates and `dayNumber` 1 and 2.
- The Day 3 activity is gone (cascade).

Then extend it back out:

```js
await fetch(`/api/trips/${...}`, { method: "PUT", body: JSON.stringify({ startDate: "2026-05-01", endDate: "2026-05-05" }), ... })
```

Verify the response has 5 days, the old Day 1/2 still exist with their original `id`s, and new Day 3/4/5 exist (empty). Test an inverted range (endDate < startDate) → should 400 from the schema refine.

Delete the throwaway trip after testing.

- [ ] **Step 4: Commit**

```bash
git add server/api/trips/[id].put.ts
git commit -m "feat(trip): reconcile itinerary days when trip dates change"
```

---

## Task 7: Build `EditTripModal.vue`

**Files:**
- Create: `app/components/EditTripModal.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
interface TripLike {
  destination: string
  startDate: string
  endDate: string
}

interface DayToDelete {
  id: string
  dayNumber: number
  date: string
  activityCount: number
  activityNames: string[]
}

const props = defineProps<{
  open: boolean
  tripId: string
  trip: TripLike
}>()

const emit = defineEmits<{
  updated: [payload: unknown]
  close: []
}>()

const destination = ref(props.trip.destination)
const startDate = ref(props.trip.startDate)
const endDate = ref(props.trip.endDate)
const submitting = ref(false)
const error = ref<string | null>(null)

const stage = ref<"form" | "confirm">("form")
const daysToDelete = ref<DayToDelete[]>([])
const daysToAdd = ref(0)

// Keep the form in sync when the parent opens the modal for a different trip or
// after an external update.
watch(
  () => [props.open, props.trip],
  () => {
    if (props.open) {
      destination.value = props.trip.destination
      startDate.value = props.trip.startDate
      endDate.value = props.trip.endDate
      stage.value = "form"
      error.value = null
    }
  },
  { deep: true },
)

const datesChanged = computed(
  () => startDate.value !== props.trip.startDate || endDate.value !== props.trip.endDate,
)

const destinationChanged = computed(() => destination.value.trim() !== props.trip.destination)

const anyChange = computed(() => datesChanged.value || destinationChanged.value)

const rangeValid = computed(() => endDate.value >= startDate.value)

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

async function handleSubmit() {
  error.value = null
  if (!destination.value.trim()) {
    error.value = "Destination is required"
    return
  }
  if (!rangeValid.value) {
    error.value = "End date must be on or after start date"
    return
  }
  if (!anyChange.value) {
    emit("close")
    return
  }

  submitting.value = true
  try {
    if (datesChanged.value) {
      const preview = await $fetch<{ daysToDelete: DayToDelete[]; daysToAdd: number }>(
        `/api/trips/${props.tripId}/date-change-preview`,
        {
          query: { startDate: startDate.value, endDate: endDate.value },
        },
      )
      const destructive = preview.daysToDelete.filter((d) => d.activityCount > 0)
      if (destructive.length > 0) {
        daysToDelete.value = destructive
        daysToAdd.value = preview.daysToAdd
        stage.value = "confirm"
        submitting.value = false
        return
      }
    }
    await commitUpdate()
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to save changes"
  } finally {
    submitting.value = false
  }
}

async function commitUpdate() {
  submitting.value = true
  try {
    const result = await $fetch(`/api/trips/${props.tripId}`, {
      method: "PUT",
      body: {
        destination: destination.value.trim(),
        startDate: startDate.value,
        endDate: endDate.value,
      },
    })
    emit("updated", result)
    emit("close")
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to save changes"
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="fixed inset-0 bg-black/40" @click="emit('close')" />
      <div class="relative z-10 mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <!-- Form stage -->
        <template v-if="stage === 'form'">
          <h2 class="text-lg font-display text-sand-900">Edit trip</h2>

          <form class="mt-4 space-y-4" @submit.prevent="handleSubmit">
            <div>
              <label class="block text-sm font-medium text-sand-700">Destination</label>
              <input
                v-model="destination"
                type="text"
                required
                class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-sand-700">Start date</label>
                <input
                  v-model="startDate"
                  type="date"
                  required
                  class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-sand-700">End date</label>
                <input
                  v-model="endDate"
                  type="date"
                  required
                  class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
                />
              </div>
            </div>

            <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

            <div class="flex justify-end gap-3 pt-2">
              <button
                type="button"
                class="rounded-lg border border-sand-300 px-4 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
                @click="emit('close')"
              >
                Cancel
              </button>
              <button
                type="submit"
                :disabled="submitting || !rangeValid"
                class="rounded-lg bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </form>
        </template>

        <!-- Confirm stage -->
        <template v-else>
          <h2 class="text-lg font-display text-sand-900">This will delete activities</h2>
          <p class="mt-2 text-sm text-sand-600">
            Shrinking the date range removes these days and their activities:
          </p>

          <ul class="mt-4 space-y-2 max-h-64 overflow-y-auto">
            <li
              v-for="d in daysToDelete"
              :key="d.id"
              class="rounded-lg border border-red-200 bg-red-50 p-3"
            >
              <p class="text-sm font-medium text-red-900">
                Day {{ d.dayNumber }} ({{ formatDate(d.date) }})
              </p>
              <p class="mt-1 text-xs text-red-700">
                {{ d.activityCount }}
                {{ d.activityCount === 1 ? "activity" : "activities" }}:
                {{ d.activityNames.join(", ") }}
              </p>
            </li>
          </ul>

          <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>

          <div class="flex justify-end gap-3 pt-4">
            <button
              type="button"
              class="rounded-lg border border-sand-300 px-4 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
              @click="stage = 'form'"
            >
              Back
            </button>
            <button
              type="button"
              :disabled="submitting"
              class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              @click="commitUpdate"
            >
              Delete and save
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
```

Notes:
- The `$fetch` generic `TripLike` could be made stricter (using `TripResponse`) but that type lives in `[id].vue` — keeping it loose here and narrowing at the call site avoids a cross-file type move. If the project has a shared types module, move `TripResponse` into it and import from both places instead.
- `input-focus` is an existing Tailwind utility class used by `AddActivityModal.vue`; reused as-is.

- [ ] **Step 2: Type-check + lint**

Run: `bun run build`
Expected: build succeeds.

Run: `bun run check`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 3: Commit** (no manual check here — Task 8 wires it up)

```bash
git add app/components/EditTripModal.vue
git commit -m "feat(trip): add EditTripModal component"
```

---

## Task 8: Wire EditTripModal into the trip page

**Files:**
- Modify: `app/pages/trips/[id].vue`

- [ ] **Step 1: Add modal state and handler**

Near the other modal refs in `app/pages/trips/[id].vue` (e.g. next to `addActivityModal` around line 647), add:

```ts
const showEditTripModal = ref(false)

function handleTripUpdated(updated: unknown) {
  if (!updated) return
  // Server returns the same shape as GET /api/trips/[id] minus the _role field.
  // Preserve the current _role from the existing trip.value.
  const role = trip.value?._role
  trip.value = { ...(updated as TripResponse), _role: role ?? "owner" }
}
```

- [ ] **Step 2: Add "Edit trip" item to the more-menu**

Find the `showMoreMenu` block in the template (look for `v-if="showMoreMenu"` — search the file). Inside the menu's button list, add a new button (keep the existing styling pattern of sibling items — read a neighboring menu item to match class names exactly):

```vue
<button
  v-if="!isViewer"
  type="button"
  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sand-700 hover:bg-sand-50"
  @click="
    showMoreMenu = false
    showEditTripModal = true
  "
>
  <Icon name="lucide:pencil" class="h-4 w-4" />
  Edit trip
</button>
```

If the neighboring items use different class names or icon sizes, copy theirs — the goal is visual consistency with the existing more-menu entries, not a fresh design.

- [ ] **Step 3: Mount the modal in the template**

Near where `<AddActivityModal ... />` is rendered (around line 1368), add:

```vue
<EditTripModal
  v-if="trip"
  :open="showEditTripModal"
  :trip-id="tripId"
  :trip="trip"
  @close="showEditTripModal = false"
  @updated="handleTripUpdated"
/>
```

The `v-if="trip"` guard ensures we don't mount before the initial lazy fetch resolves.

- [ ] **Step 4: Type-check + lint**

Run: `bun run build`
Expected: build succeeds.

Run: `bun run check`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 5: Manual browser verification — golden path**

Run `bun run dev`. Open a trip you own.

**Path A — no date change:**
1. Open the "more" menu → "Edit trip".
2. Change destination text only. Click Save.
3. Modal closes. Header updates to new destination. No flash.

**Path B — extend range:**
1. Open the modal.
2. Push endDate out by 2 days. Click Save.
3. Modal closes. New empty days appear in the day tabs. Existing activities remain on their original days.

**Path C — shrink range, no activities affected:**
1. Open the modal.
2. Pull endDate in by 1 day, leaving no activities on the trimmed day.
3. Click Save. Modal closes directly (no confirmation). Trimmed day is gone.

**Path D — shrink range with activities (destructive confirm):**
1. Ensure at least one activity is on the last day.
2. Open the modal, pull endDate in by 1 day. Click Save.
3. Confirmation screen lists the day + activity names.
4. Click "Back" → returns to form with fields preserved.
5. Click Save again, then "Delete and save" on confirmation. Modal closes. Day and its activities are gone.

**Path E — invalid range:**
1. Set endDate before startDate. Save button disables (`:disabled="!rangeValid"`).

**Path F — viewer role:**
1. Log in as a viewer on a shared trip. "Edit trip" item must not be visible.

- [ ] **Step 6: Commit**

```bash
git add app/pages/trips/[id].vue
git commit -m "feat(trip): wire EditTripModal into more-menu with destructive confirm"
```

---

## Final verification

- [ ] **Step 1: Full lint + type-check**

Run: `bun run build && bun run check`
Expected: build succeeds, check reports zero warnings/errors.

- [ ] **Step 2: End-to-end smoke**

Run `bun run dev`. Log in as a trip owner. Verify all three deliverables in one session:

1. IdeasBucket sits at the top of the day column above Accommodation.
2. Adding an activity updates the map and activity list in place with no flash.
3. "Edit trip" in the more-menu works through paths A–F from Task 8 Step 5.

- [ ] **Step 3: Clean up throwaway test trips from manual verification**

Use the existing trip delete flow in the UI. Do not touch the production DB directly (per project memory).
