import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { itineraryDays, reservations, stays, trips } from "../db/schema"
import {
  addCalendarDays,
  groupDaysIntoStayRuns,
  syncDayAccommodation,
  type StayRun,
  type Tx,
} from "./stays"

/**
 * The single writer that keeps `reservations` in sync with `stays`.
 *
 * Scope note (#57): stays only. `flights` is user-scoped by design — a
 * co-editor never sees another member's flights — while `reservations` is
 * trip-scoped, so auto-mirroring a flight would widen the audience of data the
 * schema deliberately narrowed. Accommodation is already trip-wide, so there is
 * no such regression there. Flights stay manual until a visibility model exists.
 */

/** Where a reservation row came from. */
export const RESERVATION_SOURCES = ["manual", "stay"] as const
export type ReservationSource = (typeof RESERVATION_SOURCES)[number]

/** The fields a derived booking still needs a human to supply. */
export const BOOKING_GAP_FIELDS = ["confirmationNumber", "provider", "amount"] as const
export type BookingGapField = (typeof BOOKING_GAP_FIELDS)[number]

/** The stay fields mirrored onto a booking row. */
export interface StayBookingSource {
  id: string
  tripId: string
  name: string
  /** Calendar date, `YYYY-MM-DD`. */
  checkIn: string
  /** Exclusive — the morning after the last night. */
  checkOut: string
}

/** An unlinked reservation the backfill may be able to adopt. */
export interface StayBookingCandidate {
  id: string
  name: string
  startDate: string | null
  endDate: string | null
}

export type StayBookingMatch =
  | { kind: "adopt"; reservationId: string }
  | { kind: "ambiguous"; reservationIds: string[] }
  | { kind: "none" }

/** An already-persisted stay, as the reconciliation planner sees it. */
export interface ExistingStay {
  id: string
  key: string
  checkIn: string
  checkOut: string
}

export interface StayReconciliationPlan {
  create: StayRun[]
  update: { stayId: string; run: StayRun }[]
  remove: string[]
}

function blank(value: string | null | undefined): boolean {
  return !value || value.trim() === ""
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when reversed. */
function calendarDaysBetween(from: string, to: string): number {
  const parse = (v: string) => {
    const [y, m, d] = v.slice(0, 10).split("-").map(Number)
    return Date.UTC(y!, m! - 1, d!)
  }
  return (parse(to) - parse(from)) / 86_400_000
}

/** Nights shared by two half-open `[start, end)` calendar ranges. */
function overlapNights(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = aStart > bStart ? aStart : bStart
  const end = aEnd < bEnd ? aEnd : bEnd
  return Math.max(0, calendarDaysBetween(start, end))
}

/**
 * Which of a derived booking's gap fields are still empty. Computed
 * server-side so the Bookings UI prompts for exactly these and nothing else.
 */
export function missingBookingFields(row: {
  confirmationNumber: string | null
  provider: string | null
  amount: string | null
}): BookingGapField[] {
  return BOOKING_GAP_FIELDS.filter((field) => blank(row[field]))
}

/**
 * Decide whether an existing hand-typed booking belongs to `stay`.
 *
 * Adoption requires an exact (normalized) name match — a fuzzy or
 * dates-only match risks attaching the wrong PNR to the wrong stay, which is
 * strictly worse than leaving the row for the user to link by hand. Anything
 * that plausibly relates but isn't certain comes back `ambiguous`.
 */
export function matchReservationToStay(
  stay: Pick<StayBookingSource, "name" | "checkIn" | "checkOut">,
  candidates: readonly StayBookingCandidate[],
): StayBookingMatch {
  const target = normalizeName(stay.name)

  const overlaps = (c: StayBookingCandidate): boolean => {
    if (!c.startDate) return false
    const start = c.startDate.slice(0, 10)
    const end = c.endDate ? c.endDate.slice(0, 10) : addCalendarDays(start, 1)
    return overlapNights(start, end, stay.checkIn, stay.checkOut) > 0
  }

  const byName = candidates.filter((c) => normalizeName(c.name) === target)

  if (byName.length === 1) return { kind: "adopt", reservationId: byName[0]!.id }

  if (byName.length > 1) {
    const overlapping = byName.filter(overlaps)
    if (overlapping.length === 1) return { kind: "adopt", reservationId: overlapping[0]!.id }
    return { kind: "ambiguous", reservationIds: byName.map((c) => c.id) }
  }

  const overlapping = candidates.filter(overlaps)
  if (overlapping.length > 0) {
    return { kind: "ambiguous", reservationIds: overlapping.map((c) => c.id) }
  }

  return { kind: "none" }
}

/**
 * Diff the stay runs a trip's days imply against the stays already stored.
 *
 * A stay is only ever reused for a run under the same key, and when a run
 * splits in two the existing stay follows the half it overlaps most — that is
 * what keeps the user's confirmation number attached to the right nights.
 */
export function planStayReconciliation(args: {
  runs: readonly StayRun[]
  existing: readonly ExistingStay[]
}): StayReconciliationPlan {
  // Score every (stay, run) pair that could legitimately be the same stay,
  // then assign greedily from the strongest overlap down.
  const pairs: { stayId: string; runIndex: number; nights: number }[] = []
  for (const stay of args.existing) {
    args.runs.forEach((run, runIndex) => {
      if (run.key !== stay.key) return
      const nights = overlapNights(run.checkIn, run.checkOut, stay.checkIn, stay.checkOut)
      if (nights > 0) pairs.push({ stayId: stay.id, runIndex, nights })
    })
  }
  pairs.sort((a, b) => b.nights - a.nights || a.runIndex - b.runIndex)

  const claimedStays = new Set<string>()
  const claimedRuns = new Set<number>()
  const update: StayReconciliationPlan["update"] = []

  for (const pair of pairs) {
    if (claimedStays.has(pair.stayId) || claimedRuns.has(pair.runIndex)) continue
    claimedStays.add(pair.stayId)
    claimedRuns.add(pair.runIndex)
    update.push({ stayId: pair.stayId, run: args.runs[pair.runIndex]! })
  }

  return {
    create: args.runs.filter((_, i) => !claimedRuns.has(i)),
    update,
    remove: args.existing.filter((s) => !claimedStays.has(s.id)).map((s) => s.id),
  }
}

/** What the backfill intends to do with one stay run. */
export interface StayBackfillPlanEntry {
  run: StayRun
  /** The stay this run already maps to, when the backfill has run before. */
  stayId: string | null
  /** A hand-typed booking to adopt onto this stay, when it's unambiguous. */
  adoptReservationId: string | null
  /** Rows that plausibly relate but are too risky to link automatically. */
  ambiguousReservationIds: string[]
}

/**
 * Decide, per stay run, whether the backfill creates a stay or reuses one, and
 * whether an existing hand-typed booking can be adopted onto it.
 *
 * Idempotent by construction: a run already covered by a stay reports that
 * stay, and its booking is no longer among the unlinked candidates, so a second
 * pass adopts and creates nothing.
 */
export function planStayBackfill(args: {
  runs: readonly StayRun[]
  existingStays: readonly ExistingStay[]
  candidates: readonly StayBookingCandidate[]
}): StayBackfillPlanEntry[] {
  const plan = planStayReconciliation({ runs: args.runs, existing: args.existingStays })
  const stayIdByRun = new Map<StayRun, string>(plan.update.map((u) => [u.run, u.stayId]))

  // A booking belongs to at most one stay — adopting it twice would leave two
  // stays claiming the same confirmation number.
  const claimed = new Set<string>()

  return args.runs.map((run) => {
    const available = args.candidates.filter((c) => !claimed.has(c.id))
    const match = matchReservationToStay(run, available)

    if (match.kind === "adopt") claimed.add(match.reservationId)

    return {
      run,
      stayId: stayIdByRun.get(run) ?? null,
      adoptReservationId: match.kind === "adopt" ? match.reservationId : null,
      ambiguousReservationIds: match.kind === "ambiguous" ? match.reservationIds : [],
    }
  })
}

/** What `upsertStayBooking` should do with the rows it found. */
export type StayBookingWrite =
  | { kind: "update"; reservationId: string }
  | { kind: "adopt"; reservationId: string }
  | { kind: "insert" }

/**
 * Decide how a stay's booking is written, given the rows already on the trip.
 *
 * The `adopt` branch is what stops a detach/re-attach cycle from splitting one
 * hotel across two booking rows. Clearing a hotel detaches its booking (the row
 * keeps the PNR and the amount — no automated path may destroy those) and
 * deletes the stay; re-setting the same hotel used to create a fresh *blank*
 * derived row beside it, so the trip carried two accommodation bookings for the
 * same nights and the budget counted the money twice as soon as the user filled
 * the new one in.
 *
 * Adoption is deliberately limited to an exact (normalized) name match, the
 * same bar the backfill uses: a stay whose name genuinely changed is a
 * different hotel, and the old row must stay behind as a detached manual
 * booking rather than have someone else's confirmation number transplanted onto
 * it. Two rows for two hotels is right; two rows for one hotel is the bug.
 */
export function planStayBookingWrite(args: {
  stay: Pick<StayBookingSource, "name" | "checkIn" | "checkOut">
  /** Rows already pointing at this stay. */
  linked: readonly { id: string }[]
  /** Previously-derived rows whose stay went away (`detached_at` is set). */
  detached: readonly StayBookingCandidate[]
}): StayBookingWrite {
  const [linked] = args.linked
  if (linked) return { kind: "update", reservationId: linked.id }

  const match = matchReservationToStay(args.stay, args.detached)
  if (match.kind === "adopt") return { kind: "adopt", reservationId: match.reservationId }

  return { kind: "insert" }
}

/**
 * Create or refresh the booking row mirroring `stay`, keyed on `stay_id`.
 *
 * Only the mirrored fields are written. The confirmation number, provider,
 * amount, status and notes are the user's, and no automated path may
 * overwrite them.
 */
export async function upsertStayBooking(
  tx: Tx,
  stay: StayBookingSource,
  createdById: string | null,
): Promise<void> {
  // Calendar dates pinned to UTC midnight, matching how the manual create route
  // stores a `YYYY-MM-DD` (`new Date("2026-03-22")`). A check-in has no time of
  // day, so every reader must render this column in UTC — see
  // `ReservationTracker.vue`, which passes `time-zone="UTC"` for exactly this.
  const mirrored = {
    name: stay.name,
    startDate: new Date(`${stay.checkIn}T00:00:00.000Z`),
    endDate: new Date(`${stay.checkOut}T00:00:00.000Z`),
  }

  const linked = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(eq(reservations.stayId, stay.id))

  const detachedRows =
    linked.length > 0
      ? []
      : await tx
          .select({
            id: reservations.id,
            name: reservations.name,
            startDate: reservations.startDate,
            endDate: reservations.endDate,
          })
          .from(reservations)
          .where(
            and(
              eq(reservations.tripId, stay.tripId),
              eq(reservations.type, "accommodation"),
              isNull(reservations.stayId),
              isNotNull(reservations.detachedAt),
            ),
          )

  const plan = planStayBookingWrite({
    stay,
    linked,
    detached: detachedRows.map((r) => ({
      id: r.id,
      name: r.name,
      startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null,
      endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
    })),
  })

  if (plan.kind === "update") {
    await tx.update(reservations).set(mirrored).where(eq(reservations.stayId, stay.id))
    return
  }

  if (plan.kind === "adopt") {
    // Re-link in place. The user's confirmation number, provider, amount,
    // status and notes are untouched — only the mirrored fields and the link.
    await tx
      .update(reservations)
      .set({ ...mirrored, stayId: stay.id, source: "stay", detachedAt: null })
      .where(eq(reservations.id, plan.reservationId))
    return
  }

  // `onConflictDoUpdate` rather than a bare insert: two editors saving
  // accommodation on the same stay concurrently both read no row, and the
  // second insert would otherwise block on `idx_reservations_stay` and then
  // raise a unique violation at commit — aborting the whole transaction and
  // losing the edit as a 500. The index is partial, so the conflict target
  // has to repeat its predicate.
  await tx
    .insert(reservations)
    .values({
      ...mirrored,
      tripId: stay.tripId,
      type: "accommodation",
      source: "stay",
      stayId: stay.id,
      createdById,
    })
    .onConflictDoUpdate({
      target: reservations.stayId,
      targetWhere: sql`stay_id is not null`,
      set: mirrored,
    })
}

/**
 * Break the link between a stay and its booking. The row survives as a manual
 * booking: the confirmation number and amount are user-entered data that no
 * automated path is allowed to destroy.
 */
export async function detachStayBooking(tx: Tx, stayId: string): Promise<void> {
  await tx
    .update(reservations)
    .set({ stayId: null, source: "manual", detachedAt: new Date() })
    .where(eq(reservations.stayId, stayId))
}

/**
 * Serialize every accommodation write on a trip. **Call this as the FIRST
 * statement of the transaction, before touching `itinerary_days`.**
 *
 * Reconciliation reads every day, plans against every stay, then writes — so
 * two concurrent edits on *different* days can both see "no stay for this run"
 * and each create one, leaving two stays, two derived bookings, and
 * `itinerary_days.stay_id` pointing at whichever committed last. The trip row
 * is the natural mutex: every accommodation write belongs to exactly one trip.
 *
 * The ordering is load-bearing, not stylistic. `reconcileTripStays` re-points
 * every one of the trip's day rows, so a caller that updated a day *before*
 * locking would hold a day lock while waiting for the trip lock, while the
 * transaction holding the trip lock waits for that day — a deadlock, which
 * Postgres resolves by aborting one editor's save. Taking the trip row first
 * everywhere gives a single lock order: `trips`, then `itinerary_days`.
 *
 * Re-entrant: `reconcileTripStays` calls it too, and a row lock already held by
 * the same transaction is a no-op.
 */
export async function lockTripForStayWrite(tx: Tx, tripId: string): Promise<void> {
  await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).for("update")
}

/** Point a set of day rows at a stay. */
async function linkDays(tx: Tx, dayIds: readonly string[], stayId: string): Promise<void> {
  if (dayIds.length === 0) return
  await tx
    .update(itineraryDays)
    .set({ stayId })
    .where(inArray(itineraryDays.id, [...dayIds]))
}

/**
 * Rebuild a trip's stays from its day rows, then mirror them into bookings.
 *
 * The day `accommodation_*` columns remain the write path — they are what the
 * accommodation routes and the AI apply step set — and this is what turns them
 * into the canonical entity. `syncDayAccommodation` then writes them back from
 * the stay, so the cache can never drift from the row it derives from.
 *
 * Safe to call repeatedly: unchanged stays are updated in place and their
 * bookings are upserted, never duplicated.
 *
 * Must be called inside a transaction that also contains the `accommodation_*`
 * write it derives from — those columns are a read-cache of `stays` and this is
 * their only reconciler, so a write that lands without one leaves the itinerary
 * and the Bookings tab disagreeing with no path back.
 */
export async function reconcileTripStays(
  tx: Tx,
  tripId: string,
  userId: string | null,
): Promise<void> {
  // A no-op when the caller already took it, which every accommodation route
  // does before its day write — see `lockTripForStayWrite` for why the order
  // matters. Repeated here so a future caller that forgets is still serialized
  // against everything except its own day locks.
  await lockTripForStayWrite(tx, tripId)

  const days = await tx
    .select({
      id: itineraryDays.id,
      date: itineraryDays.date,
      accommodationName: itineraryDays.accommodationName,
      accommodationPlaceId: itineraryDays.accommodationPlaceId,
      accommodationAddress: itineraryDays.accommodationAddress,
      accommodationLat: itineraryDays.accommodationLat,
      accommodationLng: itineraryDays.accommodationLng,
    })
    .from(itineraryDays)
    .where(eq(itineraryDays.tripId, tripId))

  const runs = groupDaysIntoStayRuns(days)

  const existingRows = await tx
    .select({
      id: stays.id,
      name: stays.name,
      placeId: stays.placeId,
      checkIn: stays.checkIn,
      checkOut: stays.checkOut,
    })
    .from(stays)
    .where(eq(stays.tripId, tripId))

  const existing: ExistingStay[] = existingRows.map((s) => ({
    id: s.id,
    key: s.placeId ?? s.name.trim().toLowerCase(),
    checkIn: s.checkIn,
    checkOut: s.checkOut,
  }))

  const plan = planStayReconciliation({ runs, existing })

  // Re-point from a clean slate so days dropped out of a run don't keep a
  // stale stay_id.
  await tx.update(itineraryDays).set({ stayId: null }).where(eq(itineraryDays.tripId, tripId))

  const fields = (run: StayRun) => ({
    name: run.name,
    placeId: run.placeId,
    address: run.address,
    lat: run.lat,
    lng: run.lng,
    checkIn: run.checkIn,
    checkOut: run.checkOut,
  })

  // Removals run FIRST so the creates below can re-adopt what they detach.
  // Moving the same hotel to different nights is a remove plus a create (the
  // key matches but the ranges don't overlap), and detaching after creating
  // would leave the user's PNR on an orphaned row while the new stay mirrored a
  // blank one beside it.
  for (const stayId of plan.remove) {
    // Detach before delete: `ON DELETE SET NULL` would clear the FK but leave
    // the row claiming to be derived from a stay that no longer exists.
    await detachStayBooking(tx, stayId)
    await tx.delete(stays).where(eq(stays.id, stayId))
  }

  for (const { stayId, run } of plan.update) {
    await tx.update(stays).set(fields(run)).where(eq(stays.id, stayId))
    await linkDays(tx, run.dayIds, stayId)
    await syncDayAccommodation(tx, { id: stayId, ...fields(run) })
    await upsertStayBooking(tx, { id: stayId, tripId, ...fields(run) }, userId)
  }

  for (const run of plan.create) {
    const [created] = await tx
      .insert(stays)
      .values({ tripId, ...fields(run) })
      .returning({ id: stays.id })
    if (!created) continue
    await linkDays(tx, run.dayIds, created.id)
    await syncDayAccommodation(tx, { id: created.id, ...fields(run) })
    await upsertStayBooking(tx, { id: created.id, tripId, ...fields(run) }, userId)
  }
}

/**
 * Unlinked accommodation bookings on a trip, as *backfill* adoption candidates.
 *
 * Rows carrying `detached_at` are excluded: those were derived once and then
 * unlinked, which is the user clearing a hotel. #59 promises they may then
 * retype that row's name and dates freely, so re-adopting it would let the next
 * accommodation write overwrite exactly the fields they were told they owned.
 * The live path re-adopts detached rows too, but only on an exact name match
 * (`planStayBookingWrite`) — the backfill has no such signal to lean on here.
 */
export async function findAdoptableStayBookings(
  tx: Tx,
  tripId: string,
): Promise<StayBookingCandidate[]> {
  const rows = await tx
    .select({
      id: reservations.id,
      name: reservations.name,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.tripId, tripId),
        eq(reservations.type, "accommodation"),
        isNull(reservations.stayId),
        isNull(reservations.detachedAt),
      ),
    )

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null,
    endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
  }))
}
