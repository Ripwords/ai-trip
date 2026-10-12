/**
 * Route-level coverage for `POST /api/flights` and `PATCH /api/flights/:id`.
 *
 * B19: PATCH attached a flight to any `tripId` it was given without checking
 *      the caller could see that trip.
 * B24: adding a flight the user already has hit the
 *      `(user_id, flight_number, flight_date)` unique index and surfaced as a
 *      raw 500 instead of a 409.
 */
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { afterAll, beforeEach, describe, it } from "bun:test"
import {
  assertStatus,
  harness,
  installNitroGlobals,
  makeEvent,
  resetHarness,
  type Handler,
} from "../route-test-harness"

installNitroGlobals()

const { db } = await import("../db")

const FLIGHT_ID = "11111111-1111-4111-8111-111111111111"
const MY_TRIP = "22222222-2222-4222-8222-222222222222"
const SOMEONE_ELSES_TRIP = "33333333-3333-4333-8333-333333333333"
const OWNER = "user-owner"

interface FlightRow {
  id: string
  userId: string
  tripId: string | null
  flightNumber: string
  flightDate: string
}

let flights: FlightRow[] = []
let writes = 0

const original = {
  insert: db.insert,
  update: db.update,
  flightsFindFirst: db.query.flights.findFirst,
  cacheFindFirst: db.query.flightApiCache.findFirst,
}

function installFakeDb(): void {
  // Every lookup in these routes is "this user's flight": by id, or by the
  // (number, date) pair the unique index covers.
  db.query.flights.findFirst = (async () =>
    flights[0] ? { ...flights[0] } : undefined) as unknown as typeof db.query.flights.findFirst
  db.query.flightApiCache.findFirst = (async () =>
    undefined) as unknown as typeof db.query.flightApiCache.findFirst

  db.update = (() => ({
    set: (values: Partial<FlightRow>) => ({
      where: () => ({
        returning: async () => {
          writes++
          const row = flights[0]!
          Object.assign(row, values)
          return [{ ...row }]
        },
      }),
    }),
  })) as unknown as typeof db.update

  // Behaves like Postgres with the unique index: a duplicate either violates it
  // (plain insert) or is skipped (ON CONFLICT DO NOTHING → no row returned).
  db.insert = (() => ({
    values: (values: FlightRow) => {
      const duplicate = flights.some(
        (f) =>
          f.userId === values.userId &&
          f.flightNumber === values.flightNumber &&
          f.flightDate === values.flightDate,
      )
      const insert = (): FlightRow[] => {
        writes++
        const row = { ...values, id: crypto.randomUUID() }
        flights.push(row)
        return [row]
      }
      return {
        returning: async () => {
          if (duplicate) {
            throw Object.assign(new Error("duplicate key value violates unique constraint"), {
              code: "23505",
            })
          }
          return insert()
        },
        onConflictDoNothing: () => ({
          returning: async () => (duplicate ? [] : insert()),
        }),
      }
    },
  })) as unknown as typeof db.insert
}

afterAll(() => {
  db.insert = original.insert
  db.update = original.update
  db.query.flights.findFirst = original.flightsFindFirst
  db.query.flightApiCache.findFirst = original.cacheFindFirst
})

const patchFlight = (await import("../api/flights/[id].patch")).default as unknown as Handler<
  FlightRow | undefined
>
const createFlight = (await import("../api/flights/index.post")).default as unknown as Handler<
  FlightRow | undefined
>

beforeEach(() => {
  installNitroGlobals()
  installFakeDb()
  resetHarness({ [MY_TRIP]: { [OWNER]: "owner" } })
  delete process.env.AERODATABOX_API_KEY
  writes = 0
  flights = [
    { id: FLIGHT_ID, userId: OWNER, tripId: null, flightNumber: "NH10", flightDate: "2026-11-01" },
  ]
})

describe("PATCH /api/flights/:id (B19)", () => {
  it("refuses to attach a flight to a trip the caller cannot access", async () => {
    await assertStatus(
      patchFlight(makeEvent({ params: { id: FLIGHT_ID }, body: { tripId: SOMEONE_ELSES_TRIP } })),
      404,
    )
    assert.equal(writes, 0)
    assert.equal(flights[0]?.tripId, null)
  })

  it("attaches a flight to a trip the caller is a member of", async () => {
    const updated = await patchFlight(
      makeEvent({ params: { id: FLIGHT_ID }, body: { tripId: MY_TRIP } }),
    )
    assert.equal(updated?.tripId, MY_TRIP)
    assert.deepEqual(harness.accessChecks, [{ tripId: MY_TRIP, userId: OWNER }])
  })

  it("detaches without a trip access check", async () => {
    flights[0]!.tripId = MY_TRIP
    const updated = await patchFlight(
      makeEvent({ params: { id: FLIGHT_ID }, body: { tripId: null } }),
    )
    assert.equal(updated?.tripId, null)
  })
})

describe("POST /api/flights (B24)", () => {
  it("returns 409 when the user already has this flight on this date", async () => {
    await assertStatus(
      createFlight(makeEvent({ body: { flightNumber: "nh 10", flightDate: "2026-11-01" } })),
      409,
    )
    assert.equal(flights.length, 1)
  })

  it("returns 409 when a concurrent add wins the race to the unique index", async () => {
    // The pre-check sees nothing; the row appears before the insert runs.
    db.query.flights.findFirst = (async () =>
      undefined) as unknown as typeof db.query.flights.findFirst
    await assertStatus(
      createFlight(makeEvent({ body: { flightNumber: "NH10", flightDate: "2026-11-01" } })),
      409,
    )
    assert.equal(flights.length, 1)
  })

  it("still adds a new flight", async () => {
    flights = []
    const created = await createFlight(
      makeEvent({ body: { flightNumber: "NH10", flightDate: "2026-11-01" } }),
    )
    assert.equal(created?.flightNumber, "NH10")
    assert.equal(flights.length, 1)
  })
})
