/**
 * One-shot backfill: build `stays` from the accommodation already denormalized
 * across `itinerary_days`, then link each stay to a booking — adopting the
 * user's existing row where that's unambiguous rather than creating a second one.
 *
 * App code rather than raw SQL on purpose: `reservations.confirmation_number`
 * is `encryptedText` (see `server/db/custom-types.ts`) and only round-trips
 * through Drizzle with `ENCRYPTION_KEY` set.
 *
 * Idempotent — running it twice changes nothing. Existing stays are reused,
 * already-linked bookings are no longer adoption candidates, and no
 * confirmation number or amount is ever overwritten.
 *
 * Stays only, per the #57 decision: flights are user-scoped while reservations
 * are trip-scoped, so mirroring them would leak a member's flights to every
 * co-editor.
 *
 * Defaults to a DRY RUN — it does the real work in a transaction and rolls it
 * back, so the report is what an apply would do. Writing is opt-in:
 *
 *   bun run db:backfill-stays              # dry run
 *   bun run db:backfill-stays -- --apply   # writes, local database only
 *   bun run db:backfill-stays -- --apply --allow-remote
 *
 * Requires DATABASE_URL and ENCRYPTION_KEY.
 */

import { pathToFileURL } from "node:url"
import { eq } from "drizzle-orm"
import { db } from "./index"
import { itineraryDays, reservations, stays, trips } from "./schema"
import { groupDaysIntoStayRuns, type StayRun, type Tx } from "../lib/stays"
import { findAdoptableStayBookings, planStayBackfill, type ExistingStay } from "../lib/booking-sync"

export interface Totals {
  staysCreated: number
  staysReused: number
  bookingsAdopted: number
  bookingsCreated: number
  ambiguous: number
}

function stayFields(run: StayRun) {
  return {
    name: run.name,
    placeId: run.placeId,
    address: run.address,
    lat: run.lat,
    lng: run.lng,
    checkIn: run.checkIn,
    checkOut: run.checkOut,
  }
}

/** Thrown to roll a dry run back once it has finished reporting. */
class DryRunRollback extends Error {}

export async function backfillTrip(tripId: string, totals: Totals, apply: boolean): Promise<void> {
  const days = await db
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
  if (runs.length === 0) return

  const existingRows = await db
    .select({
      id: stays.id,
      name: stays.name,
      placeId: stays.placeId,
      checkIn: stays.checkIn,
      checkOut: stays.checkOut,
    })
    .from(stays)
    .where(eq(stays.tripId, tripId))

  const existingStays: ExistingStay[] = existingRows.map((s) => ({
    id: s.id,
    key: s.placeId ?? s.name.trim().toLowerCase(),
    checkIn: s.checkIn,
    checkOut: s.checkOut,
  }))

  const candidates = await findAdoptableStayBookings(db, tripId)
  const plan = planStayBackfill({ runs, existingStays, candidates })

  const work = async (tx: Tx) => {
    for (const entry of plan) {
      const fields = stayFields(entry.run)

      let stayId = entry.stayId
      if (stayId) {
        await tx.update(stays).set(fields).where(eq(stays.id, stayId))
        totals.staysReused++
      } else {
        const [created] = await tx
          .insert(stays)
          .values({ tripId, ...fields })
          .returning({ id: stays.id })
        if (!created) continue
        stayId = created.id
        totals.staysCreated++
      }

      // `accommodation_*` is left exactly as it was — it is the read-cache the
      // eight remaining reader modules still use, and it already holds these
      // values. Only the link is new.
      for (const dayId of entry.run.dayIds) {
        await tx.update(itineraryDays).set({ stayId }).where(eq(itineraryDays.id, dayId))
      }

      // One booking per stay — `idx_reservations_stay` is a unique partial
      // index, so a second row for the same stay aborts the whole trip's
      // transaction and `main()` reports it as "skipping". That is a silent
      // partial backfill, and the adopt branch used to skip this check: a stay
      // that already had its derived booking plus a same-named manual row hit
      // it every time.
      const [alreadyLinked] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.stayId, stayId))

      if (alreadyLinked) {
        // Nothing to do: the stay's booking exists and its user-entered fields
        // are not ours to touch.
      } else if (entry.adoptReservationId) {
        // Adopt in place: the user's confirmation number, provider, amount and
        // status stay untouched. Only the link and the source flip.
        await tx
          .update(reservations)
          .set({ stayId, source: "stay", detachedAt: null })
          .where(eq(reservations.id, entry.adoptReservationId))
        totals.bookingsAdopted++
      } else {
        await tx.insert(reservations).values({
          tripId,
          type: "accommodation",
          source: "stay",
          stayId,
          name: entry.run.name,
          startDate: new Date(`${entry.run.checkIn}T00:00:00.000Z`),
          endDate: new Date(`${entry.run.checkOut}T00:00:00.000Z`),
        })
        totals.bookingsCreated++
      }

      if (entry.ambiguousReservationIds.length > 0) {
        totals.ambiguous += entry.ambiguousReservationIds.length
        console.log(
          `  ? ${entry.run.name} (${entry.run.checkIn}) — possible duplicate booking(s), left manual: ${entry.ambiguousReservationIds.join(", ")}`,
        )
      }
    }
  }

  // A dry run does the real work against the real planner and then rolls back,
  // so the report is what an apply would actually do rather than a second
  // implementation that can drift from it.
  try {
    await db.transaction(async (tx) => {
      await work(tx)
      if (!apply) throw new DryRunRollback()
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
}

/** True for a database we are confident is a developer's own. */
function isLocalDatabase(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  } catch {
    return false
  }
}

async function main() {
  // This script adopts and rewrites rows the user owns — it flips existing
  // bookings to `source = 'stay'`, which makes their name and dates read-only
  // in the Bookings tab. It used to run, unprompted, on import. Writing now
  // needs an explicit `--apply`, and a remote database needs `--allow-remote`
  // on top of that.
  const args = new Set(process.argv.slice(2))
  const apply = args.has("--apply")
  const url = process.env.DATABASE_URL ?? ""

  if (apply && !isLocalDatabase(url) && !args.has("--allow-remote")) {
    console.error(
      `Refusing to write to a non-local database (${new URL(url).hostname}).\n` +
        `Re-run with --allow-remote if that is genuinely what you want.`,
    )
    process.exit(2)
  }

  const allTrips = await db.select({ id: trips.id, destination: trips.destination }).from(trips)
  console.log(
    `${apply ? "Backfilling" : "DRY RUN (pass --apply to write) —"} ` +
      `scanning ${allTrips.length} trips for accommodation to promote into stays`,
  )

  const totals: Totals = {
    staysCreated: 0,
    staysReused: 0,
    bookingsAdopted: 0,
    bookingsCreated: 0,
    ambiguous: 0,
  }

  // Counted, not just logged: a per-trip failure rolls that trip back, and
  // reporting success while trips silently did nothing is how a partial
  // backfill goes unnoticed.
  let failures = 0

  for (const trip of allTrips) {
    try {
      await backfillTrip(trip.id, totals, apply)
    } catch (error) {
      failures++
      console.error(`  Failed on trip ${trip.id} (${trip.destination}) — skipping:`, error)
    }
  }

  console.log(
    `\n${apply ? "Done" : "Dry run complete — nothing was written"}. ` +
      `Stays created: ${totals.staysCreated}, reused: ${totals.staysReused}. ` +
      `Bookings adopted: ${totals.bookingsAdopted}, created: ${totals.bookingsCreated}. ` +
      `Ambiguous (left manual for the user to link): ${totals.ambiguous}. ` +
      `Trips failed: ${failures}`,
  )

  return failures
}

// Only when run as a script. This module used to call `main()` on import,
// which meant merely importing it — from a test, or from a tool walking the
// tree — rewrote user-owned booking rows on whatever DATABASE_URL was set.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
    .then((failures) => process.exit(failures > 0 ? 1 : 0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
