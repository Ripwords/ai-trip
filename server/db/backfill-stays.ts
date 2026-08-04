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
 * Run as a post-deploy job with: tsx server/db/backfill-stays.ts
 * Requires DATABASE_URL and ENCRYPTION_KEY.
 */

import { eq } from "drizzle-orm"
import { db } from "./index"
import { itineraryDays, reservations, stays, trips } from "./schema"
import { groupDaysIntoStayRuns, type StayRun } from "../lib/stays"
import { findAdoptableStayBookings, planStayBackfill, type ExistingStay } from "../lib/booking-sync"

interface Totals {
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

async function backfillTrip(tripId: string, totals: Totals): Promise<void> {
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

  await db.transaction(async (tx) => {
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

      if (entry.adoptReservationId) {
        // Adopt in place: the user's confirmation number, provider, amount and
        // status stay untouched. Only the link and the source flip.
        await tx
          .update(reservations)
          .set({ stayId, source: "stay" })
          .where(eq(reservations.id, entry.adoptReservationId))
        totals.bookingsAdopted++
      } else {
        const [alreadyLinked] = await tx
          .select({ id: reservations.id })
          .from(reservations)
          .where(eq(reservations.stayId, stayId))

        if (!alreadyLinked) {
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
      }

      if (entry.ambiguousReservationIds.length > 0) {
        totals.ambiguous += entry.ambiguousReservationIds.length
        console.log(
          `  ? ${entry.run.name} (${entry.run.checkIn}) — possible duplicate booking(s), left manual: ${entry.ambiguousReservationIds.join(", ")}`,
        )
      }
    }
  })
}

async function main() {
  const allTrips = await db.select({ id: trips.id, destination: trips.destination }).from(trips)
  console.log(`Scanning ${allTrips.length} trips for accommodation to promote into stays`)

  const totals: Totals = {
    staysCreated: 0,
    staysReused: 0,
    bookingsAdopted: 0,
    bookingsCreated: 0,
    ambiguous: 0,
  }

  for (const trip of allTrips) {
    try {
      await backfillTrip(trip.id, totals)
    } catch (error) {
      console.error(`  Failed on trip ${trip.id} (${trip.destination}) — skipping:`, error)
    }
  }

  console.log(
    `\nDone. Stays created: ${totals.staysCreated}, reused: ${totals.staysReused}. ` +
      `Bookings adopted: ${totals.bookingsAdopted}, created: ${totals.bookingsCreated}. ` +
      `Ambiguous (left manual for the user to link): ${totals.ambiguous}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
