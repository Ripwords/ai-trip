/**
 * Route-level coverage for `POST /api/trips/:id/ideas/:ideaId/promote`.
 *
 * B23: promoting an idea skipped the 30-activities-per-day cap every other add
 * path enforces, and inserted the activity and deleted the idea as two
 * unrelated statements — a failure between them, or two people promoting the
 * same idea at once, left a duplicate activity or a promoted idea still listed.
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
const schema = await import("../db/schema")

const TRIP = "11111111-1111-4111-8111-111111111111"
const IDEA = "22222222-2222-4222-8222-222222222222"
const DAY = "33333333-3333-4333-8333-333333333333"
const EDITOR = "user-editor"
const CAP = 30

interface Write {
  op: "insert" | "delete"
  table: unknown
  inTransaction: boolean
}

let activityCount = 0
/** Whether the idea is still there when the promote's delete runs. */
let ideaStillExists = true
let writes: Write[] = []
let inTransaction = false

const original = {
  transaction: db.transaction,
  insert: db.insert,
  delete: db.delete,
  select: db.select,
  ideasFindFirst: db.query.tripIdeas.findFirst,
  daysFindFirst: db.query.itineraryDays.findFirst,
  activitiesFindFirst: db.query.activities.findFirst,
}

function rows<T>(value: T[]): Promise<T[]> & { for: () => Promise<T[]> } {
  return Object.assign(Promise.resolve(value), { for: async () => value })
}

const insert = (table: unknown) => ({
  values: (values: Record<string, unknown>) => ({
    returning: async () => {
      writes.push({ op: "insert", table, inTransaction })
      return [{ id: crypto.randomUUID(), ...values }]
    },
  }),
})

const del = (table: unknown) => ({
  where: () => {
    writes.push({ op: "delete", table, inTransaction })
    const deleted = table === schema.tripIdeas && !ideaStillExists ? [] : [{ id: IDEA }]
    return Object.assign(Promise.resolve(), { returning: async () => deleted })
  },
})

const select = () => ({
  from: (table: unknown) => ({
    where: () =>
      table === schema.activities ? rows([{ count: activityCount }]) : rows([{ id: DAY }]),
  }),
})

const activitiesFindFirst = async () =>
  activityCount > 0 ? { id: "last", sortOrder: activityCount - 1 } : undefined

function installFakeDb(): void {
  db.query.tripIdeas.findFirst = (async () => ({
    id: IDEA,
    tripId: TRIP,
    name: "Ameyoko",
    placeId: null,
    type: "attraction",
    description: null,
    lat: null,
    lng: null,
    address: null,
    rating: null,
    photos: [],
    notes: null,
  })) as unknown as typeof db.query.tripIdeas.findFirst
  // Also serves `computeAndSaveSegments`, whose transit branch stops after
  // clearing the day's segments — no Distance Matrix in a unit test.
  db.query.itineraryDays.findFirst = (async () => ({
    id: DAY,
    tripId: TRIP,
    trip: { preferences: { transportMode: "transit" } },
  })) as unknown as typeof db.query.itineraryDays.findFirst
  db.query.activities.findFirst =
    activitiesFindFirst as unknown as typeof db.query.activities.findFirst
  db.insert = insert as unknown as typeof db.insert
  db.delete = del as unknown as typeof db.delete
  db.select = select as unknown as typeof db.select
  db.transaction = (async (run: (tx: unknown) => Promise<unknown>) => {
    inTransaction = true
    try {
      return await run({
        insert,
        delete: del,
        select,
        query: { activities: { findFirst: activitiesFindFirst } },
      })
    } finally {
      inTransaction = false
    }
  }) as unknown as typeof db.transaction
}

afterAll(() => {
  db.transaction = original.transaction
  db.insert = original.insert
  db.delete = original.delete
  db.select = original.select
  db.query.tripIdeas.findFirst = original.ideasFindFirst
  db.query.itineraryDays.findFirst = original.daysFindFirst
  db.query.activities.findFirst = original.activitiesFindFirst
})

const promote = (await import("../api/trips/[id]/ideas/[ideaId]/promote.post"))
  .default as unknown as Handler<{ id: string; sortOrder: number }>

const event = () =>
  makeEvent({ userId: EDITOR, params: { id: TRIP, ideaId: IDEA }, body: { itineraryDayId: DAY } })

beforeEach(() => {
  installNitroGlobals()
  installFakeDb()
  resetHarness({ [TRIP]: { [EDITOR]: "editor" } })
  activityCount = 0
  ideaStillExists = true
  writes = []
})

describe("POST promote idea (B23)", () => {
  it(`rejects promoting onto a day that already has ${CAP} activities`, async () => {
    activityCount = CAP
    await assertStatus(promote(event()), 400)
    assert.deepEqual(
      writes.filter((w) => w.table !== schema.travelSegments),
      [],
    )
  })

  it("inserts the activity and deletes the idea in one transaction", async () => {
    activityCount = 3
    const activity = await promote(event())
    assert.equal(activity.sortOrder, 3)
    const ideaWrites = writes.filter(
      (w) => w.table === schema.activities || w.table === schema.tripIdeas,
    )
    assert.deepEqual(
      ideaWrites.map((w) => [w.op, w.inTransaction]),
      [
        ["insert", true],
        ["delete", true],
      ],
    )
  })

  it("409s when a concurrent promote already consumed the idea", async () => {
    ideaStillExists = false
    await assertStatus(promote(event()), 409)
  })
})
