/**
 * Route-level coverage for `PUT /api/trips/:id/days/:dayId/reorder`.
 *
 * B10: the handler rewrote sort orders (and went on to recompute the schedule
 * and segments) before it checked that `dayId` belonged to trip `:id`. An
 * editor of one trip could reorder — and re-time — a day on someone else's
 * trip by pairing their own trip id with a foreign day id.
 */
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { afterAll, beforeEach, describe, it } from "bun:test"
import {
  assertStatus,
  installNitroGlobals,
  makeEvent,
  resetHarness,
  type Handler,
} from "../route-test-harness"

installNitroGlobals()

const { db } = await import("../db")

const MY_TRIP = "11111111-1111-4111-8111-111111111111"
const FOREIGN_DAY = "22222222-2222-4222-8222-222222222222"
const A1 = "33333333-3333-4333-8333-333333333333"
const A2 = "44444444-4444-4444-8444-444444444444"
const EDITOR = "user-editor"

/** Each write the handler attempts. The fake refuses them all: the test is
 *  that none is attempted. */
let writes = 0

const original = {
  transaction: db.transaction,
  update: db.update,
  daysFindFirst: db.query.itineraryDays.findFirst,
  activitiesFindMany: db.query.activities.findMany,
}

function installFakeDb(): void {
  // The day exists, but on another trip: an `and(id, tripId)` lookup misses.
  db.query.itineraryDays.findFirst = (async () =>
    undefined) as unknown as typeof db.query.itineraryDays.findFirst
  // A lookup by day id alone finds the foreign day's activities.
  db.query.activities.findMany = (async () => [
    { id: A1, sortOrder: 0 },
    { id: A2, sortOrder: 1 },
  ]) as unknown as typeof db.query.activities.findMany
  const refuse = () => {
    writes++
    throw new Error("write attempted before the day was proven to belong to the trip")
  }
  db.transaction = refuse as unknown as typeof db.transaction
  db.update = refuse as unknown as typeof db.update
}

afterAll(() => {
  db.transaction = original.transaction
  db.update = original.update
  db.query.itineraryDays.findFirst = original.daysFindFirst
  db.query.activities.findMany = original.activitiesFindMany
})

const reorder = (await import("../api/trips/[id]/days/[dayId]/reorder.put"))
  .default as unknown as Handler<{ success: boolean }>

beforeEach(() => {
  installNitroGlobals()
  installFakeDb()
  resetHarness({ [MY_TRIP]: { [EDITOR]: "editor" } })
  writes = 0
})

describe("PUT reorder (B10)", () => {
  it("404s on another trip's day without writing anything", async () => {
    await assertStatus(
      reorder(
        makeEvent({
          userId: EDITOR,
          params: { id: MY_TRIP, dayId: FOREIGN_DAY },
          body: { activityIds: [A2, A1] },
        }),
      ),
      404,
    )
    assert.equal(writes, 0)
  })
})
