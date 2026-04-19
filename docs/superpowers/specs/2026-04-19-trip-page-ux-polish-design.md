# Trip Page UX Polish — Design

**Date:** 2026-04-19
**Scope:** `app/pages/trips/[id].vue` and supporting server routes

## Problem

Four UX issues:

1. **Adding an activity feels like a full page refresh.** The POST succeeds, but the client then calls `await refresh()` on the whole trip's `useLazyFetch`. `status` flips to `"pending"`, content bound to that status flashes, and anything below the fold feels momentarily broken.
2. **Trip dates cannot be edited from the UI.** The backend has `PUT /api/trips/[id]` with `updateTripSchema.partial()` that already accepts `startDate`/`endDate`, but the trip page only renders the dates as read-only text. A user who picks the wrong dates has no way to fix them short of deleting and recreating the trip.
3. **The "Add places" block (`IdeasBucket`) sits at the bottom of the day column**, below the activities list. It's easy to miss — place discovery is a key entry point and should be closer to the top.
4. **The public shared view (`/shared/:token`) is a text-only list.** Addresses are plain text, not linkable to Google Maps, and there is no map visualization — viewers can't see where any of the places are spatially.

## Goals

- Instant, flicker-free feedback when adding an activity.
- A discoverable, safe way to edit trip dates (and destination) after creation, including a clear confirmation when the change would delete data.
- Reorder the day column so "Add places" lives directly under the day tabs.
- Make the shared link useful for visual planning: address links that open Google Maps, and an embedded read-only map alongside the activity list.

## Non-goals

- Migrating the trip page off `useLazyFetch` to TanStack Query (out of scope; touches the whole page).
- Editing currency / preferences / budget / status from the new modal — those already have other surfaces.
- Bulk-reassigning activities onto remaining days when the range shrinks. The user picked auto-delete-with-confirmation; that's the contract.

---

## Part 1 — Optimistic activity insert

### Server

**File:** `server/api/trips/[id]/activities/index.post.ts`

Today the endpoint returns just the inserted `activity` row. Change it to also return the day's recomputed travel segments, since the client needs both to reconcile its local state without a refetch:

```ts
await computeAndSaveSegments(itineraryDayId)

const segments = await db.query.travelSegments.findMany({
  where: eq(travelSegments.itineraryDayId, itineraryDayId),
  orderBy: [asc(travelSegments.sortOrder)],
})

return { activity, segments }
```

Segments are the only server-side side-effect beyond the inserted row itself, so returning them closes the loop.

### Client

**File:** `app/components/AddActivityModal.vue`

Change the emit signature:

```ts
const emit = defineEmits<{
  added: [payload: { activity: Activity; segments: TravelSegment[]; dayId: string }]
  close: []
}>()
```

Both `handleSearchSubmit` and `handleManualSubmit` call:

```ts
const result = await $fetch(`/api/trips/${props.tripId}/activities`, { ... })
emit("added", { activity: result.activity, segments: result.segments, dayId: props.dayId })
```

**File:** `app/pages/trips/[id].vue`

Replace `handleActivityAdded` (currently line 656-659):

```ts
function handleActivityAdded(payload: {
  activity: Activity
  segments: TravelSegment[]
  dayId: string
}) {
  if (!trip.value) return
  const day = trip.value.days.find((d) => d.id === payload.dayId)
  if (!day) return
  day.activities = [...day.activities, payload.activity]
  day.travelSegments = payload.segments
}
```

No `refresh()`, no `await`, no `status` flip. The `TripMap` watcher on `props.activities` already handles marker updates.

### Types

Either import `Activity` / `TravelSegment` from the existing `TripResponse` type or narrow to the subset the client actually needs. Do not redefine — reuse existing types per the TypeScript convention in `CLAUDE.md`.

---

## Part 2 — Edit trip modal

### New component: `app/components/EditTripModal.vue`

Mirrors `AddActivityModal.vue` structure (Teleport overlay, terra-500 primary button, sand-300 outline cancel).

**Fields:**

- `destination` (text input, required)
- `startDate` (HTML date input, required)
- `endDate` (HTML date input, required, must be ≥ startDate)

**Props / emits:**

```ts
defineProps<{ open: boolean; tripId: string; trip: TripResponse }>()
defineEmits<{ updated: [payload: TripResponse]; close: [] }>()
```

**Flow:**

1. **Idle → Submit clicked.** Client diffs form values against `props.trip`.
   - If dates unchanged → skip preflight, call PUT directly.
   - If dates changed → call `GET /api/trips/${tripId}/date-change-preview?startDate=...&endDate=...`.
2. **Preview response handling.**
   - If `daysToDelete` is empty (only adds, or pure shift with empty tails) → call PUT directly.
   - If `daysToDelete` contains days that have activities → render a confirmation screen inside the modal:
     - Heading: "This will delete activities"
     - List: "Day {n} ({formatted date}) — {count} activities: {names join ', '}"
     - Buttons: "Back" (return to form) and destructive "Delete and save" (terra-600 / red-600 border).
   - If `daysToDelete` contains days but none of them have activities → skip confirmation, call PUT directly.
3. **PUT call.** On success, emit `updated` with the full returned trip.
4. **Parent** (`[id].vue`) merges into local `trip.value` — no refetch.

### New endpoint: `server/api/trips/[id]/date-change-preview.get.ts`

Read-only. No DB writes.

```ts
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const { startDate, endDate } = await getValidatedQuery(event, dateRangeQuerySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const days = await db.query.itineraryDays.findMany({
    where: eq(itineraryDays.tripId, id),
    with: { activities: { columns: { id: true, name: true } } },
  })

  const outsideRange = days.filter((d) => d.date < startDate || d.date > endDate)

  const newDateSet = enumerateDates(startDate, endDate)
  const existingDateSet = new Set(days.map((d) => d.date))
  const daysToAdd = newDateSet.filter((d) => !existingDateSet.has(d)).length

  return {
    daysToDelete: outsideRange.map((d) => ({
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

Add `dateRangeQuerySchema` to `server/utils/schemas.ts`:

```ts
export const dateRangeQuerySchema = z
  .object({
    startDate: z.string().date(),
    endDate: z.string().date(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "endDate must be >= startDate" })
```

### Modify: `server/api/trips/[id].put.ts`

Currently the endpoint is a single blind `UPDATE trips SET ...`. Extend it to reconcile `itineraryDays` whenever `startDate` or `endDate` changes, inside a transaction:

```ts
await db.transaction(async (tx) => {
  const existing = await tx.query.trips.findFirst({ where: eq(trips.id, id) })
  const datesChanging =
    (body.startDate && body.startDate !== existing.startDate) ||
    (body.endDate && body.endDate !== existing.endDate)

  await tx.update(trips).set(body).where(eq(trips.id, id))

  if (datesChanging) {
    const newStart = body.startDate ?? existing.startDate
    const newEnd = body.endDate ?? existing.endDate

    // Delete out-of-range days (activities cascade via FK).
    await tx
      .delete(itineraryDays)
      .where(
        and(
          eq(itineraryDays.tripId, id),
          or(lt(itineraryDays.date, newStart), gt(itineraryDays.date, newEnd)),
        ),
      )

    // Insert missing days for new range.
    const remaining = await tx.query.itineraryDays.findMany({
      where: eq(itineraryDays.tripId, id),
      orderBy: [asc(itineraryDays.date)],
    })
    const remainingDates = new Set(remaining.map((d) => d.date))
    const targetDates = enumerateDates(newStart, newEnd)
    const toInsert = targetDates
      .filter((d) => !remainingDates.has(d))
      .map((date) => ({ tripId: id, date, dayNumber: 0 }))
    if (toInsert.length) await tx.insert(itineraryDays).values(toInsert)

    // Renumber dayNumber by ascending date.
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

// Return the full hydrated trip so the client can merge without refetching.
return await getTripWithRelations(id)
```

`enumerateDates` is a small pure helper (date-in / date-out, inclusive). Place it in `server/lib/dates.ts` if one doesn't exist, or extract from wherever the trip creation logic enumerates initial days (audit-check during implementation).

`getTripWithRelations(id)` should reuse whatever the existing `GET /api/trips/[id]` endpoint uses so the shape matches `TripResponse` exactly. If no such helper exists, extract one from the GET handler before wiring this in.

### Tighten the Zod schema

In `server/utils/schemas.ts`, add a refine on `updateTripSchema`:

```ts
export const updateTripSchema = createTripSchema
  .partial()
  .extend({ ...existing extensions... })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "endDate must be >= startDate",
  })
```

### Trigger from trip page

In `app/pages/trips/[id].vue`:

- Add `<button>` inside the existing `showMoreMenu` block (around line 661) labeled "Edit trip", gated on `!isViewer`.
- On click: `showEditTripModal.value = true`.
- Render `<EditTripModal :open="showEditTripModal" :trip-id="tripId" :trip="trip" @close="showEditTripModal = false" @updated="handleTripUpdated" />`.
- `handleTripUpdated(updated)` assigns `trip.value = updated` — no refetch.

---

## Part 3 — Reorder IdeasBucket above Accommodation

Single-file change in `app/pages/trips/[id].vue` lines 1181-1227.

**Current order inside the left column:**

1. `AccommodationSection`
2. `AiLoadingOverlay`
3. `DaySection`
4. `IdeasBucket`

**New order:**

1. `IdeasBucket` (moved to top)
2. `AccommodationSection`
3. `AiLoadingOverlay`
4. `DaySection`

Move the `<IdeasBucket>` block (including its `v-if`/`v-show` guards) to the top of the flex column. No prop or style changes. No changes elsewhere.

---

## Part 4 — Shared page: map + Google Maps address links

### Server change

**File:** `server/api/shared/[token].get.ts`

The endpoint currently returns `accommodationName` only (line 46) — no coordinates. Extend the day-mapping to also return `accommodationLat` and `accommodationLng` so the shared page can render the accommodation marker:

```ts
accommodationName: day.accommodationName,
accommodationLat: day.accommodationLat,
accommodationLng: day.accommodationLng,
```

No new fields on activities — `lat`, `lng`, `address`, and `name` are already returned.

### Client: embed the map

**File:** `app/pages/shared/[token].vue`

Current layout is a single centered column (`max-w-4xl`). Restructure the day content area to match the trip detail page's two-column pattern:

- Container widens to `max-w-6xl` on large screens (keep `max-w-4xl` as a sensible mobile default via responsive classes).
- Inside "Day content", wrap the activity list and a new `<TripMap>` in a `flex flex-col lg:flex-row gap-6` container.
- **Left column:** the existing activity list (unchanged aside from the address-link change below).
- **Right column:** `<TripMap>` with:
  - `:activities="activeDay.activities"` — already has `lat`/`lng`/`type`/`name`/`sortOrder`.
  - `:accommodation` — built from the new lat/lng fields.
  - Sticky on desktop (`lg:sticky lg:top-8`), fixed height similar to the trip page.
  - On mobile: `order-first` so the map shows above the list, matching the trip page.

The `TripMap` component accepts props via the existing `Activity` interface (id/name/type/lat/lng/sortOrder). Extend `SharedActivity` → make sure all required fields are covered (they are: already defined in `shared/[token].vue:4-17`).

The map's `@marker-click` emit goes unwired on the shared page (no list-scroll behavior wanted for the public view).

### Client: address → Google Maps link

In the same file, where activities currently render a plain `<span>` for the address (lines 171-173), replace with:

```vue
<a
  v-if="activity.address"
  :href="mapsLinkFor(activity)"
  target="_blank"
  rel="noopener noreferrer"
  class="text-xs text-sand-500 hover:text-terra-600 hover:underline truncate"
>
  {{ activity.address }}
</a>
```

Add a small helper in `<script setup>`:

```ts
function mapsLinkFor(activity: SharedActivity): string {
  const base = "https://www.google.com/maps/search/?api=1&query="
  if (activity.lat != null && activity.lng != null) {
    return `${base}${activity.lat},${activity.lng}`
  }
  const q = [activity.name, activity.address].filter(Boolean).join(", ")
  return `${base}${encodeURIComponent(q)}`
}
```

Rationale for lat/lng preference: Google Maps resolves coordinates unambiguously to the same point the trip owner pinned, regardless of how the address string may change over time. The name+address fallback is only for activities that somehow lack coordinates (shouldn't happen for Places-API-resolved entries, but covers manual-entry cases).

### Scope guardrails

- No travel-segment dividers on the shared list — keep the public view clean.
- No ideas bucket, no "Add activity" affordance, no editing — shared page stays strictly read-only.
- The `SharedTrip` / `SharedDay` / `SharedActivity` interfaces in `shared/[token].vue` need the accommodation coords added to `SharedDay`. No other type changes.
- Google Maps JS API loads via the existing `useGoogleMaps` composable. The key is already exposed to the client for the private trip page; it works identically for anonymous visitors on the shared page (no new env var or config).

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  app/pages/trips/[id].vue                                   │
│                                                             │
│  - useLazyFetch<TripResponse>(`/api/trips/${id}`)           │
│                                                             │
│  Day column order (new):                                    │
│    IdeasBucket → AccommodationSection → AI overlay →        │
│    DaySection                                               │
│                                                             │
│  handleActivityAdded(payload) → local merge (no refresh)    │
│  handleTripUpdated(payload)   → local merge (no refresh)    │
│                                                             │
│  "More" menu → "Edit trip" → EditTripModal                  │
└─────────────────────────────────────────────────────────────┘
        │                                        │
        │ POST /activities                       │ GET /date-change-preview
        │ returns { activity, segments }         │ returns { daysToDelete, daysToAdd }
        │                                        │
        │                                        │ PUT /trips/:id
        │                                        │ returns full TripResponse
        ▼                                        ▼
┌──────────────────────────┐   ┌─────────────────────────────────────┐
│ activities/index.post.ts │   │ [id].put.ts                         │
│                          │   │                                     │
│ insert activity          │   │ tx:                                 │
│ computeAndSaveSegments() │   │   update trips                      │
│ query segments           │   │   if dates changed:                 │
│ return {activity,segs}   │   │     delete out-of-range days        │
└──────────────────────────┘   │     insert missing days             │
                               │     renumber dayNumbers             │
                               │ return hydrated trip                │
                               └─────────────────────────────────────┘
```

## Testing

Per `CLAUDE.md`, tests come first.

- **Unit (server):** `date-change-preview` — empty range, same range, extend-only, shrink-only-empty-days, shrink-with-activities, shift-forward, shift-backward, invalid `endDate < startDate`.
- **Unit (server):** `PUT /trips/[id]` — date-unchanged (fast path), date-extend (adds days, renumbers), date-shrink (deletes days + cascades activities, renumbers), date-shift (mix of add/delete/renumber), invalid range rejected.
- **Integration:** `POST /trips/[id]/activities` — response shape includes both `activity` and `segments`; segments reflect the newly-added activity.
- **Component:** `EditTripModal` — renders correctly; preview call skipped when dates unchanged; confirmation screen appears only when `daysToDelete` has activities; "Back" returns to form; "Delete and save" calls PUT.
- **Manual (must verify in browser, per `CLAUDE.md` UI rule):**
  - Add an activity — map marker appears instantly, no layout flash, segments render between activities without delay.
  - Edit trip with no date change — saves silently.
  - Edit trip shrinking range over a day with activities — confirmation lists them; confirming deletes them.
  - Edit trip extending range — new empty days appear.
  - IdeasBucket renders above Accommodation in the day column on desktop and mobile.
  - Shared page renders map next to activity list on desktop, above the list on mobile; address links open Google Maps in a new tab to the correct pin (coordinate-based); switching day tabs updates the map markers.

## Risks / open questions

- **TripResponse shape.** If `TripResponse` doesn't currently include `travelSegments` per day in the same shape the server returns, align types during implementation. Reuse the GET handler's select/query logic for both endpoints to guarantee shape parity.
- **Cascading deletes across other relations.** Activities cascade from `itineraryDays`, which is sufficient. But if any other table (expenses keyed by day, flights, reservations) has day-level FKs, verify cascade behavior before merging. Quick audit during implementation.
- **Concurrent edits.** A collaborator editing dates while another adds activities could cause lost writes. Out of scope for this spec — the existing app doesn't handle this anywhere else either. Flag for a later collaboration-hardening pass.

## Files touched

**New:**

- `app/components/EditTripModal.vue`
- `server/api/trips/[id]/date-change-preview.get.ts`
- `server/lib/dates.ts` (if `enumerateDates` doesn't already exist)

**Modified:**

- `app/pages/trips/[id].vue` (layout reorder, handlers, modal mount, more-menu item)
- `app/components/AddActivityModal.vue` (emit signature)
- `app/pages/shared/[token].vue` (map embed, address links, two-column layout, accommodation lat/lng typing)
- `server/api/trips/[id]/activities/index.post.ts` (return segments)
- `server/api/trips/[id].put.ts` (transactional date reconciliation)
- `server/api/shared/[token].get.ts` (return accommodation lat/lng)
- `server/utils/schemas.ts` (`dateRangeQuerySchema`, refine on `updateTripSchema`)

**Unchanged:**

- `TripMap.vue` — already reactive on `props.activities`; reused on the shared page as-is.
- `IdeasBucket.vue` — just moved in the DOM.
- `server/db/schema/*` — no migration needed; cascade FK already in place.
