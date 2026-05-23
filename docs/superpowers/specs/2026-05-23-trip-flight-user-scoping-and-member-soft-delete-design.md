# Trip flight user-scoping & member soft-delete

Date: 2026-05-23

## Background

Two related issues surfaced while looking at how flight data flows on shared trips:

1. **Cross-member flight leak on the trip page.** `/api/trips/[id]/flights` returns every flight linked to the trip, regardless of which user owns the row. The trip page (`app/pages/trips/[id].vue`) feeds that list into the accommodation card's arrival/departure badges, the trip airports map markers, and the flight globe — so any member sees every other member's flight numbers, times, and airports. That contradicts the user-scoped flight model (`flights.userId` is `notNull`, each flight belongs to one user). A previous security commit (a7e1b62) hid `reservations.confirmationNumber` from viewers for the same class of concern but did not touch flight fields.
2. **Hard-deleted memberships orphan their data.** `DELETE /api/trips/[id]/members/[memberId]` removes the `tripMembers` row outright. The kicked user's `flights` rows still point at the trip via `flights.tripId`, so their data continues to influence what remaining members see. Once Change 1 lands the leak is per-user only, but the orphaned rows are still a sign of inconsistent cleanup.

The dashboard pre-trip briefing is **not** in scope. It already reads from `/api/flights` (user-scoped); when a member has no flight linked, falling back to `trip.startDate` is the correct personal view under the user-scoped model.

## Goals

- Make trip-page features that derive from flights user-scoped: a member only sees their own flight info on the accommodation card, map markers, and globe.
- Stop hard-deleting trip memberships, so no membership row is destroyed while the user's `flights` rows remain linked to the trip.
- Preserve audit history (activity log entries plus the soft-deleted row itself).
- No DB migration required (the affected columns are already `text`).

## Non-goals

- Adding any trip-level aggregate over multiple members' flights (no `effectiveStartDate` or similar). Each member's reality is their own.
- Changing the dashboard pre-trip briefing.
- Touching the public `/shared/<token>` page.
- Changing flight ownership semantics (`flights.userId` stays `notNull`).
- Cascading cleanup of other ex-member-authored artifacts (activity comments, votes, ideas, expenses). Out of scope here; addressable as a follow-up once we know whether to keep them as historical record or strip them on kick.

## Change 1 — User-scope `/api/trips/[id]/flights`

**File:** `server/api/trips/[id]/flights.get.ts`

Add the caller's `userId` to the row filter. Authorization stays via `requireTripAccess` (any role); data scoping is a separate concern.

```ts
// before
const rows = await db.query.flights.findMany({
  where: eq(flights.tripId, id),
  orderBy: (f, { asc, sql }) => [asc(f.flightDate), sql`${f.departureTime} ASC NULLS LAST`],
})

// after
const rows = await db.query.flights.findMany({
  where: and(eq(flights.tripId, id), eq(flights.userId, session.user.id)),
  orderBy: (f, { asc, sql }) => [asc(f.flightDate), sql`${f.departureTime} ASC NULLS LAST`],
})
```

The `maybeMigrateRow` loop below remains unchanged — it operates per row independently of who owns the flight.

### Downstream effects (no client edits needed)

All of these consume `useLazyFetch('/api/trips/${tripId}/flights')` via the `tripFlights` / `sortedTripFlights` refs in `app/pages/trips/[id].vue`:

- `activeDayArrivalFlight` (line 460) and `activeDayDepartureFlight` (line 475) → arrival/departure badges in `AccommodationSection.vue`
- `tripAirports` (line 498) → airport markers on the trip map
- `activeDayAirports` (line 541) → per-day airport markers
- `<LazyFlightGlobe :flights="sortedTripFlights" />` (line 1536) → flight globe visualization

All of these automatically become user-scoped once the endpoint is scoped. Behavior change: if Member A links AA123 to the trip, only A sees AA123 on the accommodation card, map, and globe. Member B continues to see only their own linked flights (or nothing, if they have none linked).

### Other consumers of `flights.tripId`

A repo scan confirms `eq(flights.tripId, ...)` appears in:

- `server/api/trips/[id]/flights.get.ts` — the file being changed.
- `server/api/flights/index.get.ts` — already user-scoped (`eq(flights.userId, session.user.id)`). No change.
- Migration SQL files — not runtime code.

No other endpoint reads cross-user trip flights, so the scope change is self-contained.

## Change 2 — Soft-delete trip members

### Schema

**File:** `server/db/schema/trip-members.ts`

The `status` column is already `text` with no enum constraint. Update the inline comment to document the new value:

```ts
status: text("status").notNull().default("pending"), // "pending" | "active" | "expired" | "removed"
```

No migration is required.

### DELETE handler

**File:** `server/api/trips/[id]/members/[memberId].delete.ts`

Replace the row deletion with a status update and clear the invite token:

```ts
// before
await db.delete(tripMembers).where(eq(tripMembers.id, memberId))

// after
await db
  .update(tripMembers)
  .set({ status: "removed", inviteToken: null })
  .where(eq(tripMembers.id, memberId))
```

Clearing `inviteToken` ensures any stale invite link for that row stops working. The existing `logTripAction("member_removed", …)` call stays — that audit entry is the canonical record of the kick event.

### Access guard

**File:** `server/utils/trip-access.ts`

No change. The guard already requires `eq(tripMembers.status, "active")`, so any row with `status="removed"` (or `"pending"`, `"expired"`) is treated as no access — the kicked user gets a 404 on the next request, same as before.

### Invite handler (re-invite of a previously-removed user)

**File:** `server/api/trips/[id]/members/invite.post.ts`

Today this handler hard-deletes any existing non-active row before inserting a new one (lines 47–49 for known users, lines 60–62 for pending-by-email). Under soft-delete, those `db.delete(...)` calls would destroy the audit trail we just chose to preserve.

Change both branches to `db.update` that flips the existing row back to `pending` with fresh token and expiry, rather than deleting + inserting. Conceptually:

```ts
if (existing && existing.status === "active") {
  throw createError({ statusCode: 409, message: "This user is already a member" })
}

if (existing) {
  // Reactivate the existing row (covers "removed", "expired", "pending")
  await db
    .update(tripMembers)
    .set({
      role: body.role,
      invitedBy: session.user.id,
      invitedEmail: body.email,
      status: "pending",
      inviteToken: hashedToken,
      expiresAt,
    })
    .where(eq(tripMembers.id, existing.id))
} else {
  // No prior membership for this user — insert as today
  await db.insert(tripMembers).values({ ... })
}
```

Same treatment for the email-only branch (the `existingByEmail` lookup) — with one additional fix: today that query only matches `status="pending"`, which would miss a `"removed"` non-registered invitee (a pending invite that was kicked before the invitee ever registered). Broaden the status criterion to "any non-active row" so the reactivation path covers `"pending"`, `"expired"`, and `"removed"`:

```ts
const existingByEmail = await db.query.tripMembers.findFirst({
  where: and(
    eq(tripMembers.tripId, id),
    eq(tripMembers.invitedEmail, body.email),
    ne(tripMembers.status, "active"),
  ),
})
```

(The `"active"` case is already handled earlier when the invitee is a registered user; for an unregistered email there is no `"active"` row by construction, since activation requires a user account.)

Net effect: each `(tripId, userId)` (or `(tripId, invitedEmail)` for unregistered invitees) is represented by at most one row over time, whose `status` lifecycle is `pending → active → removed → pending → active → …`.

## Behavior matrix after the changes

| Scenario                                                         | Before                                                                                                          | After                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member A views trip page, A has linked AA123, B has linked BA456 | A sees both AA123 and BA456 on accommodation/map/globe                                                          | A sees only AA123                                                                                                                                                                                                                                                                     |
| Member B views trip page, same trip                              | B sees both AA123 and BA456                                                                                     | B sees only BA456                                                                                                                                                                                                                                                                     |
| Member who has linked no flights views trip page                 | Sees every other member's flights                                                                               | Sees nothing flight-related on the trip page (correct; they have no personal travel info to show)                                                                                                                                                                                     |
| Owner kicks a member                                             | `tripMembers` row deleted; `flights.tripId` rows orphaned and still influence remaining members' trip-page data | `tripMembers.status` set to `"removed"`, `inviteToken` cleared. Remaining members no longer see the ex-member's flights because Change 1 already scopes the endpoint to the caller. Ex-member's flight rows stay associated to the trip in the DB but are invisible to other members. |
| Owner re-invites a previously-removed user                       | New row inserted (after deleting the old one)                                                                   | Existing `"removed"` row updated back to `"pending"` with a fresh token.                                                                                                                                                                                                              |
| Kicked user reuses an old invite link                            | Row gone, link fails                                                                                            | Row exists but `inviteToken` is `null`, so token lookup fails.                                                                                                                                                                                                                        |
| Activity log of past kicks                                       | Preserved in `activity_log` only                                                                                | Preserved in `activity_log` AND on the `tripMembers` row itself (`status="removed"`).                                                                                                                                                                                                 |

## Testing

Following the project's TDD convention, write tests first.

### Server tests

- `server/api/trips/[id]/flights.get.test.ts` (new or extend if exists):
  - Caller is owner, owner has a flight linked → returns owner's flight only.
  - Caller is viewer member, owner has a flight and viewer has none → returns empty array.
  - Caller is viewer member, both owner and viewer have flights linked → returns viewer's flight only.
  - Caller has no access → 404 (unchanged behavior from `requireTripAccess`).

- `server/api/trips/[id]/members/[memberId].delete.test.ts` (new or extend):
  - Owner removes an active member → row's `status` becomes `"removed"`, `inviteToken` is `null`, row still exists.
  - Removed member's next request to a trip endpoint → 404 via `requireTripAccess`.
  - Activity log entry written.

- `server/api/trips/[id]/members/invite.post.test.ts` (extend):
  - Inviting a user with an existing `"removed"` row → row is updated to `"pending"` with new token/expiry; no new row created.
  - Inviting a user with an existing `"active"` row → 409 (unchanged).
  - Inviting a user with no prior row → fresh insert (unchanged).

### Client tests

No new client tests required. The trip page's flight-derived UI behavior is identical from the consumer side — it just gets a smaller, user-scoped list. Existing tests that assert badge / marker / globe rendering should still pass against the data they currently mock.

If any existing test stubs `/api/trips/[id]/flights` to return flights belonging to a different `userId`, update those fixtures to set `userId` to the caller. Search: `tripFlights` and `sortedTripFlights` in `app/**/*.test.ts`.

## Out-of-scope follow-ups

These are intentionally not part of this spec but are worth tracking once it lands:

- **Cascade cleanup of other ex-member contributions** on kick (activity comments, votes, ideas, expenses). Decide whether to keep them as historical record (recommended) or strip them.
- **`removedAt` / `removedBy` columns on `tripMembers`** for richer audit without joining `activity_log`. Skipped here to avoid a migration.
- **Globe / map "show all members' flights" toggle** if the user ever wants a shared cross-member view. Currently no UI affordance asks for that.

## Risks

- **Existing test fixtures** that rely on `/api/trips/[id]/flights` returning cross-user data may need their flight `userId` updated. Low risk — caught immediately by failing tests.
- **Invite handler refactor** must be careful about the email-only branch (`existingByEmail`): a `"removed"` row for a non-registered invitee is identified by `invitedEmail`, not `userId`. The reactivation logic must cover both branches.
- **Soft-delete and the unique index implications**: `tripMembers` has indexes on `tripId`, `userId`, `invitedEmail`, `inviteToken` — all non-unique. There is no uniqueness constraint to clash with, so leaving a `"removed"` row in place does not block re-invite by other paths. Confirmed against `server/db/schema/trip-members.ts`.
