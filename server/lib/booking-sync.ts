import { and, eq, inArray, isNull } from "drizzle-orm"
import { itineraryDays, reservations, stays } from "../db/schema"
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
  const mirrored = {
    name: stay.name,
    startDate: new Date(`${stay.checkIn}T00:00:00.000Z`),
    endDate: new Date(`${stay.checkOut}T00:00:00.000Z`),
  }

  const [existing] = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(eq(reservations.stayId, stay.id))

  if (existing) {
    await tx.update(reservations).set(mirrored).where(eq(reservations.stayId, stay.id))
    return
  }

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
    .returning()
}

/**
 * Break the link between a stay and its booking. The row survives as a manual
 * booking: the confirmation number and amount are user-entered data that no
 * automated path is allowed to destroy.
 */
export async function detachStayBooking(tx: Tx, stayId: string): Promise<void> {
  await tx
    .update(reservations)
    .set({ stayId: null, source: "manual" })
    .where(eq(reservations.stayId, stayId))
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
 */
export async function reconcileTripStays(
  tx: Tx,
  tripId: string,
  userId: string | null,
): Promise<void> {
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

  for (const stayId of plan.remove) {
    // Detach before delete: `ON DELETE SET NULL` would clear the FK but leave
    // the row claiming to be derived from a stay that no longer exists.
    await detachStayBooking(tx, stayId)
    await tx.delete(stays).where(eq(stays.id, stayId))
  }
}

/** Unlinked accommodation bookings on a trip, as adoption candidates. */
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
      ),
    )

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null,
    endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
  }))
}
