/**
 * Integration test for the `itinerary_days.updated_at` triggers (migration
 * 0043) against REAL Postgres.
 *
 * A trigger is exactly the thing a fake cannot model: the whole point of it is
 * that it fires for writers the application does not know about, including
 * DELETEs, other trip members, and raw SQL. Every assertion below is therefore
 * made through plain SQL rather than the ORM — that is also what makes it
 * immune to the drift between a local database and the current schema.
 *
 * What rides on this: a day that changed but did not bump `updated_at` makes a
 * stale AI proposal read as still-current, which re-enables an Undo that
 * restores a snapshot from before someone else's edits and discards them.
 *
 * Opt-in, like the rest of the database suite:
 *
 *   DAY_TOUCH_DB_TEST=1 bun test server/db/day-updated-at.db.test.ts
 *
 * Point DATABASE_URL at the LOCAL docker Postgres, with 0042 and 0043 applied.
 * It creates and deletes its own trip; never run it against production.
 */

import assert from "node:assert/strict"
import { describe, it, before, after, beforeEach } from "node:test"

const enabled = process.env.DAY_TOUCH_DB_TEST === "1"

describe("itinerary_days.updated_at triggers (postgres)", { skip: !enabled }, async () => {
  if (!enabled) return

  const { db } = await import("./index")
  const { sql } = await import("drizzle-orm")

  const userId = `day-touch-test-${crypto.randomUUID()}`
  let tripId = ""
  let dayOne = ""
  let dayTwo = ""

  async function versionOf(dayId: string): Promise<Date> {
    const rows = await db.execute<{ updated_at: Date }>(
      sql`SELECT "updated_at" FROM "itinerary_days" WHERE "id" = ${dayId}`,
    )
    return new Date(rows.rows[0]!.updated_at)
  }

  /** Freeze a day at a known-old version so any bump is unmistakable. */
  async function backdate(dayId: string) {
    await db.execute(
      sql`UPDATE "itinerary_days" SET "updated_at" = TIMESTAMPTZ '2020-01-01 00:00:00Z' WHERE "id" = ${dayId}`,
    )
  }

  const OLD = new Date("2020-01-01T00:00:00Z").getTime()

  before(async () => {
    await db.execute(sql`
      INSERT INTO "user" ("id", "name", "email", "email_verified")
      VALUES (${userId}, 'Day Touch Test', ${`${userId}@example.test`}, false)
    `)
    const trip = await db.execute<{ id: string }>(sql`
      INSERT INTO "trips" ("user_id", "destination", "start_date", "end_date")
      VALUES (${userId}, 'Osaka', '2026-10-01', '2026-10-02')
      RETURNING "id"
    `)
    tripId = trip.rows[0]!.id
    const days = await db.execute<{ id: string }>(sql`
      INSERT INTO "itinerary_days" ("trip_id", "day_number", "date")
      VALUES (${tripId}, 1, '2026-10-01'), (${tripId}, 2, '2026-10-02')
      RETURNING "id"
    `)
    dayOne = days.rows[0]!.id
    dayTwo = days.rows[1]!.id
  })

  after(async () => {
    if (tripId) await db.execute(sql`DELETE FROM "trips" WHERE "id" = ${tripId}`)
    await db.execute(sql`DELETE FROM "user" WHERE "id" = ${userId}`)
  })

  beforeEach(async () => {
    await db.execute(
      sql`DELETE FROM "activities" WHERE "itinerary_day_id" IN (${dayOne}, ${dayTwo})`,
    )
    await backdate(dayOne)
    await backdate(dayTwo)
  })

  async function addActivity(dayId: string, name = "Tsuta"): Promise<string> {
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO "activities" ("itinerary_day_id", "name", "type", "sort_order")
      VALUES (${dayId}, ${name}, 'restaurant', 0)
      RETURNING "id"
    `)
    return rows.rows[0]!.id
  }

  it("bumps the day when an activity is INSERTed", async () => {
    await addActivity(dayOne)
    assert.ok(
      (await versionOf(dayOne)).getTime() > OLD,
      "adding a stop must count as changing the day",
    )
  })

  it("bumps the day when an activity is UPDATEd", async () => {
    const activityId = await addActivity(dayOne)
    await backdate(dayOne)

    await db.execute(sql`UPDATE "activities" SET "name" = 'Ichiran' WHERE "id" = ${activityId}`)
    assert.ok((await versionOf(dayOne)).getTime() > OLD)
  })

  it("bumps the day when an activity is DELETEd", async () => {
    const activityId = await addActivity(dayOne)
    await backdate(dayOne)

    // The case no application-maintained column can cover: after this statement
    // there is no row left to carry a timestamp, yet the day HAS changed.
    await db.execute(sql`DELETE FROM "activities" WHERE "id" = ${activityId}`)
    assert.ok((await versionOf(dayOne)).getTime() > OLD)
  })

  it("bumps BOTH days when an activity moves from one day to another", async () => {
    const activityId = await addActivity(dayOne)
    await backdate(dayOne)
    await backdate(dayTwo)

    await db.execute(
      sql`UPDATE "activities" SET "itinerary_day_id" = ${dayTwo} WHERE "id" = ${activityId}`,
    )

    assert.ok((await versionOf(dayOne)).getTime() > OLD, "the day it left has changed")
    assert.ok((await versionOf(dayTwo)).getTime() > OLD, "the day it arrived on has changed")
  })

  it("bumps the day when the day row itself changes", async () => {
    await db.execute(
      sql`UPDATE "itinerary_days" SET "accommodation_name" = 'Hotel Granvia' WHERE "id" = ${dayOne}`,
    )
    assert.ok((await versionOf(dayOne)).getTime() > OLD)
  })

  it("leaves a neighbouring day alone", async () => {
    await addActivity(dayOne)
    assert.equal(
      (await versionOf(dayTwo)).getTime(),
      OLD,
      "only the day that changed may be bumped, or every proposal on the trip lapses at once",
    )
  })

  it("does not bump on a no-op UPDATE of the day row", async () => {
    await db.execute(
      sql`UPDATE "itinerary_days" SET "day_number" = "day_number" WHERE "id" = ${dayOne}`,
    )
    assert.equal((await versionOf(dayOne)).getTime(), OLD)
  })

  it("lets an explicit updated_at win, so a migration can still set it", async () => {
    await db.execute(
      sql`UPDATE "itinerary_days" SET "updated_at" = TIMESTAMPTZ '2021-06-01 00:00:00Z', "notes" = 'x' WHERE "id" = ${dayOne}`,
    )
    assert.equal((await versionOf(dayOne)).getTime(), new Date("2021-06-01T00:00:00Z").getTime())
  })

  it("bumps for a writer the application knows nothing about", async () => {
    // Stands in for a co-traveller editing through a route this user never
    // calls, a backfill script, or psql. The trigger cannot tell them apart —
    // which is the entire reason it is a trigger.
    await db.execute(sql`
      INSERT INTO "activities" ("itinerary_day_id", "name", "type", "sort_order")
      VALUES (${dayOne}, 'Added by someone else', 'attraction', 1)
    `)
    assert.ok((await versionOf(dayOne)).getTime() > OLD)
  })
})
