/**
 * Integration test for the stays backfill against REAL Postgres.
 *
 * The backfill adopts and rewrites rows the user owns, and the two defects it
 * had were both database-level: a missing "does this stay already have a
 * booking" check that violated the partial unique index and rolled the whole
 * trip back as a swallowed "skipping", and adoption of rows the user had
 * deliberately detached. Neither is visible to a fake — the first is the index,
 * the second is what the SELECT does or does not filter out.
 *
 * Opt-in, like the rest of the database suite:
 *
 *   STAYS_DB_TEST=1 bun test server/db/backfill-stays.db.test.ts
 *
 * Point DATABASE_URL at the LOCAL docker Postgres. It creates and deletes its
 * own trip; never run it against a production database.
 */

import assert from "node:assert/strict"
import { describe, it, before, after, beforeEach } from "node:test"

const enabled = process.env.STAYS_DB_TEST === "1"

describe("backfillTrip (postgres)", { skip: !enabled }, async () => {
  if (!enabled) return

  const { db } = await import("./index")
  const { trips, itineraryDays, reservations, stays, user } = await import("./schema")
  const { asc, eq } = await import("drizzle-orm")
  const { backfillTrip } = await import("./backfill-stays")
  type Totals = import("./backfill-stays").Totals

  const userId = `backfill-test-${crypto.randomUUID()}`
  let tripId = ""
  const DATES = ["2026-10-01", "2026-10-02", "2026-10-03"] as const

  const totals = (): Totals => ({
    staysCreated: 0,
    staysReused: 0,
    bookingsAdopted: 0,
    bookingsCreated: 0,
    ambiguous: 0,
  })

  before(async () => {
    await db.insert(user).values({
      id: userId,
      name: "Backfill Test",
      email: `${userId}@example.test`,
      emailVerified: false,
    })
    const [trip] = await db
      .insert(trips)
      .values({ userId, destination: "Osaka", startDate: DATES[0], endDate: DATES[2] })
      .returning()
    tripId = trip!.id
  })

  after(async () => {
    if (tripId) await db.delete(trips).where(eq(trips.id, tripId))
    await db.delete(user).where(eq(user.id, userId))
  })

  beforeEach(async () => {
    await db.delete(reservations).where(eq(reservations.tripId, tripId))
    await db.delete(itineraryDays).where(eq(itineraryDays.tripId, tripId))
    await db.delete(stays).where(eq(stays.tripId, tripId))
    await db.insert(itineraryDays).values(
      DATES.map((date, i) => ({
        tripId,
        date,
        dayNumber: i + 1,
        // The pre-stays world: the hotel copied onto every day it covers.
        accommodationName: "Hotel Nikko",
        accommodationPlaceId: "place-nikko",
      })),
    )
  })

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
      })
      .from(reservations)
      .where(eq(reservations.tripId, tripId))
      .orderBy(asc(reservations.name))
  }

  const listStays = () =>
    db.select({ id: stays.id, name: stays.name }).from(stays).where(eq(stays.tripId, tripId))

  it("promotes the run to a stay and creates its booking", async () => {
    const t = totals()
    await backfillTrip(tripId, t, true)

    assert.equal(t.staysCreated, 1)
    assert.equal(t.bookingsCreated, 1)
    const bookings = await listBookings()
    assert.equal(bookings.length, 1)
    assert.equal(bookings[0]!.source, "stay")
    assert.equal(bookings[0]!.stayId, (await listStays())[0]!.id)
  })

  it("adopts the user's booking in place, keeping their PNR and amount", async () => {
    await db.insert(reservations).values({
      tripId,
      type: "accommodation",
      source: "manual",
      name: "Hotel Nikko",
      confirmationNumber: "PNR1",
      amount: "900.00",
    })

    const t = totals()
    await backfillTrip(tripId, t, true)

    assert.equal(t.bookingsAdopted, 1)
    assert.equal(t.bookingsCreated, 0)
    const bookings = await listBookings()
    assert.equal(bookings.length, 1, "it linked the existing row rather than adding a second")
    assert.equal(bookings[0]!.source, "stay")
    assert.equal(bookings[0]!.confirmationNumber, "PNR1")
    assert.equal(bookings[0]!.amount, "900.00")
  })

  it("is idempotent — a second pass changes nothing", async () => {
    await backfillTrip(tripId, totals(), true)
    const first = await listBookings()
    const firstStays = await listStays()

    const t = totals()
    await backfillTrip(tripId, t, true)

    assert.equal(t.staysCreated, 0)
    assert.equal(t.staysReused, 1)
    assert.equal(t.bookingsCreated, 0)
    assert.deepEqual(await listBookings(), first)
    assert.deepEqual(await listStays(), firstStays)
  })

  // The defect: the adopt branch skipped the "already linked" check the else
  // branch had, so a stay that already carried its derived booking plus a
  // same-named manual row violated `idx_reservations_stay`. The trip's
  // transaction rolled back and `main()` swallowed it as "skipping" — a silent
  // partial backfill.
  it("does not violate the one-booking-per-stay index when both rows exist", async () => {
    await backfillTrip(tripId, totals(), true)
    // The user then hand-types a second row with the same name.
    await db.insert(reservations).values({
      tripId,
      type: "accommodation",
      source: "manual",
      name: "Hotel Nikko",
      confirmationNumber: "PNR2",
    })

    const t = totals()
    await backfillTrip(tripId, t, true)

    assert.equal(t.bookingsAdopted, 0, "the stay already had a booking")
    assert.equal(t.bookingsCreated, 0)
    const bookings = await listBookings()
    assert.equal(bookings.length, 2)
    assert.equal(bookings.filter((b) => b.stayId !== null).length, 1)
    assert.ok(
      bookings.some((b) => b.confirmationNumber === "PNR2" && b.stayId === null),
      "the user's extra row survives, unlinked",
    )
  })

  // #59 promises a detached row is the user's again — name and dates included.
  // Adopting it would let the next accommodation write overwrite exactly what
  // they were told they owned.
  it("never adopts a row the user deliberately detached", async () => {
    await db.insert(reservations).values({
      tripId,
      type: "accommodation",
      source: "manual",
      name: "Hotel Nikko",
      confirmationNumber: "PNR-OLD",
      detachedAt: new Date("2026-04-01T00:00:00.000Z"),
    })

    const t = totals()
    await backfillTrip(tripId, t, true)

    assert.equal(t.bookingsAdopted, 0)
    assert.equal(t.bookingsCreated, 1, "the stay gets its own fresh row instead")
    const detached = (await listBookings()).find((b) => b.confirmationNumber === "PNR-OLD")
    assert.ok(detached)
    assert.equal(detached.stayId, null, "still unlinked")
    assert.ok(detached.detachedAt instanceof Date, "and still marked detached")
  })

  it("writes nothing at all in a dry run", async () => {
    const t = totals()
    await backfillTrip(tripId, t, false)

    assert.equal(t.staysCreated, 1, "it still reports what an apply would do")
    assert.equal(await listStays().then((s) => s.length), 0)
    assert.equal(await listBookings().then((b) => b.length), 0)
  })
})
