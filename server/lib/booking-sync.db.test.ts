/**
 * Integration test for `reconcileTripStays` against REAL Postgres.
 *
 * `reconcileTripStays` is the only thing the accommodation routes, the AI apply
 * step, the day-undo and the trip date change call, and it was previously
 * untested — the composition, not its parts. That gap is why
 * `itinerary_days.accommodation_*` could drift from `stays`, and it cannot be
 * closed with a fake: the behaviours that matter here are the partial unique
 * index on `stay_id`, `ON CONFLICT`, `SELECT … FOR UPDATE` and what two
 * concurrent transactions actually do to each other. A hand-written fake that
 * ignored those would pass while the SQL was wrong.
 *
 * Opt-in, because the rest of the suite is pure and needs no database:
 *
 *   STAYS_DB_TEST=1 bun test server/lib/booking-sync.db.test.ts
 *
 * Point DATABASE_URL at the LOCAL docker Postgres. It creates and deletes its
 * own trip; never run it against a production database.
 */

import assert from "node:assert/strict"
import { describe, it, before, after, beforeEach } from "node:test"

const enabled = process.env.STAYS_DB_TEST === "1"

describe("reconcileTripStays (postgres)", { skip: !enabled }, async () => {
  if (!enabled) return

  const { db } = await import("../db")
  const { trips, itineraryDays, reservations, stays, user } = await import("../db/schema")
  const { and, asc, eq } = await import("drizzle-orm")
  const { lockTripForStayWrite, reconcileTripStays } = await import("./booking-sync")

  const userId = `stays-test-${crypto.randomUUID()}`
  let tripId = ""
  /** Day id by date, for the fixtures below. */
  const dayId = new Map<string, string>()

  const DATES = [
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
  ] as const

  before(async () => {
    await db.insert(user).values({
      id: userId,
      name: "Stays Test",
      email: `${userId}@example.test`,
      emailVerified: false,
    })
    const [trip] = await db
      .insert(trips)
      .values({
        userId,
        destination: "Kyoto, Japan",
        startDate: DATES[0],
        endDate: DATES[5],
      })
      .returning()
    tripId = trip!.id
  })

  after(async () => {
    if (tripId) await db.delete(trips).where(eq(trips.id, tripId))
    await db.delete(user).where(eq(user.id, userId))
  })

  beforeEach(async () => {
    // Full reset: reservations first (they reference stays), then stays, then
    // the days, so every test starts from a trip with no accommodation at all.
    await db.delete(reservations).where(eq(reservations.tripId, tripId))
    await db.delete(itineraryDays).where(eq(itineraryDays.tripId, tripId))
    await db.delete(stays).where(eq(stays.tripId, tripId))
    dayId.clear()
    const rows = await db
      .insert(itineraryDays)
      .values(DATES.map((date, i) => ({ tripId, date, dayNumber: i + 1 })))
      .returning({ id: itineraryDays.id, date: itineraryDays.date })
    for (const row of rows) dayId.set(row.date, row.id)
  })

  /** Set a hotel on a set of dates, exactly as the accommodation routes do. */
  async function setAccommodation(
    dates: readonly string[],
    hotel: { name: string | null; placeId?: string | null; address?: string | null },
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await lockTripForStayWrite(tx, tripId)
      for (const date of dates) {
        await tx
          .update(itineraryDays)
          .set({
            accommodationName: hotel.name,
            accommodationPlaceId: hotel.placeId ?? null,
            accommodationAddress: hotel.address ?? null,
            accommodationLat: null,
            accommodationLng: null,
          })
          .where(eq(itineraryDays.id, dayId.get(date)!))
      }
      await reconcileTripStays(tx, tripId, userId)
    })
  }

  async function listStays() {
    return db
      .select({
        id: stays.id,
        name: stays.name,
        placeId: stays.placeId,
        checkIn: stays.checkIn,
        checkOut: stays.checkOut,
      })
      .from(stays)
      .where(eq(stays.tripId, tripId))
      .orderBy(asc(stays.checkIn))
  }

  async function listBookings() {
    return db
      .select({
        id: reservations.id,
        name: reservations.name,
        source: reservations.source,
        stayId: reservations.stayId,
        detachedAt: reservations.detachedAt,
        amount: reservations.amount,
        confirmationNumber: reservations.confirmationNumber,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
      })
      .from(reservations)
      .where(eq(reservations.tripId, tripId))
      .orderBy(asc(reservations.startDate))
  }

  async function listDays() {
    return db
      .select({
        date: itineraryDays.date,
        stayId: itineraryDays.stayId,
        accommodationName: itineraryDays.accommodationName,
      })
      .from(itineraryDays)
      .where(eq(itineraryDays.tripId, tripId))
      .orderBy(asc(itineraryDays.date))
  }

  /** The user filling in the gaps the itinerary can't know. */
  async function fillBooking(
    id: string,
    values: { amount?: string; confirmationNumber?: string },
  ): Promise<void> {
    await db.update(reservations).set(values).where(eq(reservations.id, id))
  }

  const iso = (date: string) => new Date(`${date}T00:00:00.000Z`)

  // -------------------------------------------------------------------------

  it("promotes a run of days into one stay with one derived booking", async () => {
    await setAccommodation(["2026-09-01", "2026-09-02", "2026-09-03"], {
      name: "Hotel Nikko",
      placeId: "place-nikko",
    })

    const staysNow = await listStays()
    assert.equal(staysNow.length, 1)
    assert.equal(staysNow[0]!.name, "Hotel Nikko")
    assert.equal(staysNow[0]!.checkIn, "2026-09-01")
    // Exclusive: the morning after the last night.
    assert.equal(staysNow[0]!.checkOut, "2026-09-04")

    const bookings = await listBookings()
    assert.equal(bookings.length, 1)
    assert.equal(bookings[0]!.source, "stay")
    assert.equal(bookings[0]!.stayId, staysNow[0]!.id)
    assert.equal(bookings[0]!.name, "Hotel Nikko")
    assert.deepEqual(bookings[0]!.startDate, iso("2026-09-01"))
    assert.deepEqual(bookings[0]!.endDate, iso("2026-09-04"))

    const days = await listDays()
    assert.deepEqual(
      days.map((d) => d.stayId),
      [staysNow[0]!.id, staysNow[0]!.id, staysNow[0]!.id, null, null, null],
    )
  })

  it("is idempotent — reconciling an unchanged trip creates no second booking", async () => {
    await setAccommodation(["2026-09-01", "2026-09-02"], { name: "Hotel Nikko" })
    const before = await listStays()

    await db.transaction((tx) => reconcileTripStays(tx, tripId, userId))
    await db.transaction((tx) => reconcileTripStays(tx, tripId, userId))

    assert.deepEqual(await listStays(), before)
    assert.equal((await listBookings()).length, 1)
  })

  it("resizes the stay and its booking when the run grows", async () => {
    await setAccommodation(["2026-09-01", "2026-09-02"], { name: "Hotel Nikko" })
    const [booking] = await listBookings()
    await fillBooking(booking!.id, { amount: "900.00", confirmationNumber: "PNR1" })

    await setAccommodation(["2026-09-03"], { name: "Hotel Nikko" })

    const staysNow = await listStays()
    assert.equal(staysNow.length, 1)
    assert.equal(staysNow[0]!.checkOut, "2026-09-04")

    const bookings = await listBookings()
    assert.equal(bookings.length, 1, "the stay grew — it did not become a second booking")
    assert.equal(bookings[0]!.id, booking!.id)
    assert.deepEqual(bookings[0]!.endDate, iso("2026-09-04"))
    assert.equal(bookings[0]!.amount, "900.00", "the user's money survives a resize")
    assert.equal(bookings[0]!.confirmationNumber, "PNR1")
  })

  // Splitting a run must keep the PNR on the larger half rather than dropping
  // both stays and re-creating them blank.
  it("keeps the booking on the most-overlapping half when a run splits", async () => {
    await setAccommodation(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"], {
      name: "Hotel Nikko",
    })
    const [original] = await listBookings()
    await fillBooking(original!.id, { amount: "900.00", confirmationNumber: "PNR1" })
    const [originalStay] = await listStays()

    // Day 3 becomes somewhere else, splitting 1-2 from 4.
    await setAccommodation(["2026-09-03"], { name: "Ryokan Asaba" })

    const staysNow = await listStays()
    assert.deepEqual(
      staysNow.map((s) => [s.name, s.checkIn, s.checkOut]),
      [
        ["Hotel Nikko", "2026-09-01", "2026-09-03"],
        ["Ryokan Asaba", "2026-09-03", "2026-09-04"],
        ["Hotel Nikko", "2026-09-04", "2026-09-05"],
      ],
    )

    const kept = staysNow.find((s) => s.id === originalStay!.id)
    assert.ok(kept, "the original stay survives the split")
    assert.equal(kept.checkIn, "2026-09-01", "it follows the half it overlaps most")

    const withMoney = (await listBookings()).filter((b) => b.amount === "900.00")
    assert.equal(withMoney.length, 1, "the amount was not duplicated across the split")
    assert.equal(withMoney[0]!.stayId, originalStay!.id)
  })

  it("merges two runs of the same hotel when the gap between them closes", async () => {
    await setAccommodation(["2026-09-01"], { name: "Hotel Nikko" })
    await setAccommodation(["2026-09-03"], { name: "Hotel Nikko" })
    assert.equal((await listStays()).length, 2, "a revisit is two stays, not one")

    await setAccommodation(["2026-09-02"], { name: "Hotel Nikko" })

    const staysNow = await listStays()
    assert.equal(staysNow.length, 1)
    assert.equal(staysNow[0]!.checkIn, "2026-09-01")
    assert.equal(staysNow[0]!.checkOut, "2026-09-04")

    const linked = (await listBookings()).filter((b) => b.stayId !== null)
    assert.equal(linked.length, 1, "the merged stay has exactly one booking")
  })

  it("detaches rather than deletes when the hotel is cleared", async () => {
    await setAccommodation(["2026-09-01", "2026-09-02"], { name: "Hotel Nikko" })
    const [booking] = await listBookings()
    await fillBooking(booking!.id, { amount: "900.00", confirmationNumber: "PNR1" })

    await setAccommodation(["2026-09-01", "2026-09-02"], { name: null })

    assert.equal((await listStays()).length, 0)
    const bookings = await listBookings()
    assert.equal(bookings.length, 1, "a paid PNR is never destroyed by an unlink")
    assert.equal(bookings[0]!.source, "manual")
    assert.equal(bookings[0]!.stayId, null)
    assert.ok(bookings[0]!.detachedAt instanceof Date)
    assert.equal(bookings[0]!.amount, "900.00")
    assert.equal(bookings[0]!.confirmationNumber, "PNR1")
  })

  // BLOCKER 4. Clearing a hotel detaches its booking; re-setting the same hotel
  // used to mirror a fresh BLANK row beside it, so the trip carried two
  // accommodation bookings for the same nights and the budget counted the
  // hotel twice the moment the user filled the new one in.
  it("re-adopts the detached booking when the same hotel is set again", async () => {
    await setAccommodation(["2026-09-01", "2026-09-02"], { name: "Hotel Nikko" })
    const [booking] = await listBookings()
    await fillBooking(booking!.id, { amount: "900.00", confirmationNumber: "PNR1" })

    await setAccommodation(["2026-09-01", "2026-09-02"], { name: null })
    await setAccommodation(["2026-09-01", "2026-09-02"], { name: "Hotel Nikko" })

    const bookings = await listBookings()
    assert.equal(bookings.length, 1, "one hotel, one booking")
    assert.equal(bookings[0]!.id, booking!.id, "the SAME row came back, not a blank twin")
    assert.equal(bookings[0]!.source, "stay")
    assert.equal(bookings[0]!.detachedAt, null)
    assert.equal(bookings[0]!.amount, "900.00")
    assert.equal(bookings[0]!.confirmationNumber, "PNR1")
    assert.equal(bookings[0]!.stayId, (await listStays())[0]!.id)
  })

  it("follows the same hotel to different nights instead of leaving an orphan", async () => {
    await setAccommodation(["2026-09-01", "2026-09-02"], { name: "Hotel Nikko" })
    const [booking] = await listBookings()
    await fillBooking(booking!.id, { amount: "900.00" })

    // One reconcile that both drops the old nights and adds the new ones.
    await db.transaction(async (tx) => {
      await lockTripForStayWrite(tx, tripId)
      for (const date of ["2026-09-01", "2026-09-02"]) {
        await tx
          .update(itineraryDays)
          .set({ accommodationName: null, accommodationPlaceId: null })
          .where(eq(itineraryDays.id, dayId.get(date)!))
      }
      for (const date of ["2026-09-05", "2026-09-06"]) {
        await tx
          .update(itineraryDays)
          .set({ accommodationName: "Hotel Nikko", accommodationPlaceId: null })
          .where(eq(itineraryDays.id, dayId.get(date)!))
      }
      await reconcileTripStays(tx, tripId, userId)
    })

    const bookings = await listBookings()
    assert.equal(bookings.length, 1)
    assert.equal(bookings[0]!.id, booking!.id)
    assert.equal(bookings[0]!.amount, "900.00")
    assert.deepEqual(bookings[0]!.startDate, iso("2026-09-05"))
    assert.deepEqual(bookings[0]!.endDate, iso("2026-09-07"))
  })

  // The other side of the re-adoption rule: a genuinely different hotel is two
  // bookings, and the old PNR must stay on the old name rather than being
  // transplanted onto the new one.
  it("leaves a different hotel's booking detached instead of transplanting the PNR", async () => {
    await setAccommodation(["2026-09-01", "2026-09-02"], { name: "Hotel Nikko" })
    const [booking] = await listBookings()
    await fillBooking(booking!.id, { amount: "900.00", confirmationNumber: "PNR1" })

    await setAccommodation(["2026-09-01", "2026-09-02"], { name: "Ryokan Asaba" })

    const bookings = await listBookings()
    assert.equal(bookings.length, 2)
    const old = bookings.find((b) => b.id === booking!.id)!
    const fresh = bookings.find((b) => b.id !== booking!.id)!
    assert.equal(old.name, "Hotel Nikko")
    assert.equal(old.source, "manual")
    assert.equal(old.confirmationNumber, "PNR1")
    assert.equal(fresh.name, "Ryokan Asaba")
    assert.equal(fresh.source, "stay")
    assert.equal(fresh.confirmationNumber, null, "the new hotel gets no one else's PNR")
  })

  // BLOCKER 2's shape, at the level `PUT /api/trips/:id` reaches: deleting days
  // out of the trip must resize the stay, not leave it covering dates the trip
  // no longer contains.
  it("resizes a stay when the trip's days are deleted under it", async () => {
    await setAccommodation(["2026-09-04", "2026-09-05", "2026-09-06"], { name: "Hotel Nikko" })

    await db.transaction(async (tx) => {
      await lockTripForStayWrite(tx, tripId)
      await tx
        .delete(itineraryDays)
        .where(and(eq(itineraryDays.tripId, tripId), eq(itineraryDays.date, "2026-09-06")))
      await reconcileTripStays(tx, tripId, userId)
    })

    const staysNow = await listStays()
    assert.equal(staysNow.length, 1)
    assert.equal(staysNow[0]!.checkOut, "2026-09-06", "check-out follows the last remaining night")
    const bookings = await listBookings()
    assert.deepEqual(bookings[0]!.endDate, iso("2026-09-06"))
  })

  it("removes the stay entirely when every one of its days is deleted", async () => {
    await setAccommodation(["2026-09-05", "2026-09-06"], { name: "Hotel Nikko" })
    const [booking] = await listBookings()
    await fillBooking(booking!.id, { amount: "900.00" })

    await db.transaction(async (tx) => {
      await lockTripForStayWrite(tx, tripId)
      for (const date of ["2026-09-05", "2026-09-06"]) {
        await tx
          .delete(itineraryDays)
          .where(and(eq(itineraryDays.tripId, tripId), eq(itineraryDays.date, date)))
      }
      await reconcileTripStays(tx, tripId, userId)
    })

    assert.equal((await listStays()).length, 0)
    const bookings = await listBookings()
    assert.equal(bookings.length, 1)
    assert.equal(bookings[0]!.stayId, null)
    assert.equal(bookings[0]!.amount, "900.00")
  })

  it("writes the stay back onto the day read-cache", async () => {
    await setAccommodation(["2026-09-01", "2026-09-02"], {
      name: "Hotel Nikko",
      placeId: "place-nikko",
      address: "Ginza",
    })

    // Corrupt the cache directly, then reconcile: `syncDayAccommodation` is the
    // single writer, so it must restore what the stay says.
    await db
      .update(itineraryDays)
      .set({ accommodationName: "Wrong Hotel" })
      .where(eq(itineraryDays.id, dayId.get("2026-09-02")!))
    await db.transaction((tx) => reconcileTripStays(tx, tripId, userId))

    const days = await listDays()
    assert.equal(days.find((d) => d.date === "2026-09-02")!.accommodationName, "Hotel Nikko")
  })

  // -------------------------------------------------------------------------
  // Concurrency — the reason this file talks to a real database at all.
  // -------------------------------------------------------------------------

  // The mutual exclusion itself, asserted directly rather than inferred from a
  // race that happens to come out right: while another transaction holds the
  // trip row, a reconcile must WAIT. Without the `FOR UPDATE`, two reconciles
  // plan against the same stale read and each create a stay for the same run.
  it("blocks on the trip row while another transaction holds it", async () => {
    let releaseHolder = (): void => {}
    const holderReady = Promise.withResolvers<void>()
    const holderMayFinish = new Promise<void>((resolve) => {
      releaseHolder = resolve
    })

    const holder = db.transaction(async (tx) => {
      await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).for("update")
      holderReady.resolve()
      await holderMayFinish
    })

    await holderReady.promise

    let reconciled = false
    const waiter = db
      .transaction((tx) => reconcileTripStays(tx, tripId, userId))
      .then(() => {
        reconciled = true
      })

    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(reconciled, false, "the reconcile ran while another writer held the trip")

    releaseHolder()
    await holder
    await waiter
    assert.equal(reconciled, true, "it must proceed once the lock is released")
  })

  it("serializes two concurrent reconciles on different days into one stay", async () => {
    // Mirrors the routes exactly, lock first — see `lockTripForStayWrite`.
    const edit = (date: string) =>
      db.transaction(async (tx) => {
        await lockTripForStayWrite(tx, tripId)
        await tx
          .update(itineraryDays)
          .set({ accommodationName: "Hotel Nikko", accommodationPlaceId: "place-nikko" })
          .where(eq(itineraryDays.id, dayId.get(date)!))
        await reconcileTripStays(tx, tripId, userId)
      })

    // Without the `SELECT … FOR UPDATE` on the trip row, both transactions read
    // "no stay for this run" and each create one: two stays, two derived
    // bookings, and `itinerary_days.stay_id` pointing at whichever committed
    // last.
    await Promise.all([edit("2026-09-01"), edit("2026-09-02")])

    const staysNow = await listStays()
    assert.equal(staysNow.length, 1, "one contiguous run is one stay")
    assert.equal(staysNow[0]!.checkIn, "2026-09-01")
    assert.equal(staysNow[0]!.checkOut, "2026-09-03")

    const bookings = await listBookings()
    assert.equal(bookings.length, 1)
    assert.equal(bookings[0]!.stayId, staysNow[0]!.id)

    const days = await listDays()
    for (const date of ["2026-09-01", "2026-09-02"]) {
      assert.equal(days.find((d) => d.date === date)!.stayId, staysNow[0]!.id)
    }
  })

  it("survives two concurrent reconciles of the very same day", async () => {
    const edit = () =>
      db.transaction(async (tx) => {
        await lockTripForStayWrite(tx, tripId)
        await tx
          .update(itineraryDays)
          .set({ accommodationName: "Hotel Nikko", accommodationPlaceId: "place-nikko" })
          .where(eq(itineraryDays.id, dayId.get("2026-09-01")!))
        await reconcileTripStays(tx, tripId, userId)
      })

    await Promise.all([edit(), edit(), edit()])

    assert.equal((await listStays()).length, 1)
    assert.equal((await listBookings()).length, 1)
  })

  // Proves the index the design leans on is really there: without it every
  // repeated accommodation write would spawn another booking row.
  it("refuses a second booking for the same stay at the database level", async () => {
    await setAccommodation(["2026-09-01"], { name: "Hotel Nikko" })
    const [stay] = await listStays()

    await assert.rejects(
      db.insert(reservations).values({
        tripId,
        type: "accommodation",
        source: "stay",
        stayId: stay!.id,
        name: "Hotel Nikko",
      }),
      (error: unknown) => {
        for (let cur: unknown = error, depth = 0; cur && depth < 5; depth++) {
          if (
            typeof cur === "object" &&
            "constraint" in cur &&
            (cur as { constraint?: string }).constraint === "idx_reservations_stay"
          ) {
            return true
          }
          cur = (cur as { cause?: unknown }).cause
        }
        return false
      },
    )
  })

  // Two rows may sit at `stay_id IS NULL` — the index is partial for exactly
  // this reason, and a detached booking would otherwise block every other one.
  it("allows any number of unlinked accommodation bookings", async () => {
    await db.insert(reservations).values([
      { tripId, type: "accommodation", source: "manual", name: "A" },
      { tripId, type: "accommodation", source: "manual", name: "B" },
    ])
    assert.equal((await listBookings()).length, 2)
  })
})
