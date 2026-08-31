/**
 * Policy coverage for the two trip write paths, which `server/lib/trip-writes.ts`
 * now owns. The HTTP handlers are thin adapters over these functions and an MCP
 * tool layer calls the same code, so the caps, the authorization check and the
 * audit write belong here rather than being asserted once per transport.
 *
 * `requireTripAccess` and `logTripAction` run as the real implementations
 * against the fake database below — stubbing them would delete the only thing
 * the authorization and audit cases are for. Google Places and segment
 * recomputation are injected stubs: network and unrelated machinery.
 *
 * Fake-db limitation, as in expenses-routes.test.ts: drizzle `where` clauses are
 * opaque objects here, so the fake resolves rows against the `request` recorded
 * by the call helpers rather than by interpreting SQL.
 */

// Never let this file reach a real database: the fake replaces every method it
// uses, but the connection string is overridden regardless.
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { db } = await import("../db")
const schema = await import("../db/schema")
const { createTrip, addActivity } = await import("./trip-writes")

type CreateTripInput = import("./trip-writes").CreateTripInput
type AddActivityInput = import("./trip-writes").AddActivityInput
type AddActivityDeps = NonNullable<Parameters<typeof addActivity>[3]>

/** The caps the tests are about. Duplicated on purpose: they assert the
 *  externally-observable limit, not whatever constant the implementation uses. */
const TRIP_CAP = 50
const ACTIVITY_CAP = 30

const TRIP_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_TRIP_ID = "22222222-2222-4222-8222-222222222222"
const DAY_ID = "33333333-3333-4333-8333-333333333333"
const OTHER_DAY_ID = "44444444-4444-4444-8444-444444444444"
const OWNER_ID = "user-owner"
const EDITOR_ID = "user-editor"
const VIEWER_ID = "user-viewer"
const STRANGER_ID = "user-stranger"

interface TripRow {
  id: string
  userId: string
  destination: string
  name: string | null
  countryCode: string
  startDate: string
  endDate: string
  preferences: Record<string, unknown>
  currencyCode: string
}

interface DayRow {
  id: string
  tripId: string
  dayNumber: number
  date: string
}

interface ActivityRow {
  id: string
  itineraryDayId: string
  name: string
  placeId: string | null
  sortOrder: number
  rating: string | null
  openingHours: string[] | null
  priceLevel: number | null
  costEstimate: string | null
}

interface MemberRow {
  tripId: string
  userId: string
  role: "editor" | "viewer"
  status: "active" | "pending"
}

interface LogRow {
  tripId: string
  userId: string
  action: string
  description: string
}

interface SegmentRow {
  id: string
  itineraryDayId: string
}

interface Store {
  trips: TripRow[]
  days: DayRow[]
  activities: ActivityRow[]
  members: MemberRow[]
  log: LogRow[]
  segments: SegmentRow[]
}

/** Which trip/day/user the in-flight call is about — see the note above. */
interface CurrentRequest {
  userId: string
  tripId: string
  itineraryDayId: string
}

let store: Store = emptyStore()
let request: CurrentRequest = { userId: OWNER_ID, tripId: TRIP_ID, itineraryDayId: DAY_ID }
/** Every day id `computeAndSaveSegments` was asked to recompute, in order. */
let segmentRuns: string[] = []

function emptyStore(): Store {
  return { trips: [], days: [], activities: [], members: [], log: [], segments: [] }
}

function seed(overrides: Partial<Store> = {}): void {
  store = { ...emptyStore(), ...overrides }
  segmentRuns = []
}

function makeTrip(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: TRIP_ID,
    userId: OWNER_ID,
    destination: "Japan",
    name: null,
    countryCode: "JP",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    preferences: {},
    currencyCode: "JPY",
    ...overrides,
  }
}

function makeActivity(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: crypto.randomUUID(),
    itineraryDayId: DAY_ID,
    name: "Existing",
    placeId: null,
    sortOrder: 0,
    rating: null,
    openingHours: null,
    priceLevel: null,
    costEstimate: null,
    ...overrides,
  }
}

/** A trip owned by OWNER_ID with one day, an active editor and an active viewer. */
function seedTripWithDay(overrides: Partial<Store> = {}): void {
  seed({
    trips: [makeTrip()],
    days: [{ id: DAY_ID, tripId: TRIP_ID, dayNumber: 1, date: "2026-09-01" }],
    members: [
      { tripId: TRIP_ID, userId: EDITOR_ID, role: "editor", status: "active" },
      { tripId: TRIP_ID, userId: VIEWER_ID, role: "viewer", status: "active" },
    ],
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Fake database
// ---------------------------------------------------------------------------

/** Awaitable that also exposes `.returning()`, like drizzle's builders. */
interface Terminal<T> extends PromiseLike<T> {
  returning: () => Promise<T>
}

// Drizzle's query builders are themselves thenables — awaiting one runs the
// statement — so faking them means building thenables too.
// oxlint-disable no-thenable
function terminal<T>(run: () => Promise<T>, defaultValue: T): Terminal<T> {
  return {
    then: (onFulfilled, onRejected) =>
      run()
        .then(() => defaultValue)
        .then(onFulfilled, onRejected),
    returning: () => run(),
  }
}
// oxlint-enable no-thenable

function insertTrip(values: Record<string, unknown>): TripRow {
  const row: TripRow = {
    id: crypto.randomUUID(),
    userId: String(values.userId),
    destination: String(values.destination),
    name: (values.name as string | null) ?? null,
    countryCode: String(values.countryCode),
    startDate: String(values.startDate),
    endDate: String(values.endDate),
    preferences: (values.preferences as Record<string, unknown> | undefined) ?? {},
    currencyCode: String(values.currencyCode),
  }
  store.trips.push(row)
  // `getTripWithRelations` reads back the row that was just written, and its
  // `where` is opaque here, so the fake follows the insert.
  request = { ...request, tripId: row.id }
  return row
}

function insertActivity(values: Record<string, unknown>): ActivityRow {
  const row: ActivityRow = {
    id: crypto.randomUUID(),
    itineraryDayId: String(values.itineraryDayId),
    name: String(values.name),
    placeId: (values.placeId as string | undefined) ?? null,
    sortOrder: Number(values.sortOrder),
    rating: (values.rating as string | undefined) ?? null,
    openingHours: (values.openingHours as string[] | undefined) ?? null,
    priceLevel: (values.priceLevel as number | undefined) ?? null,
    costEstimate: (values.costEstimate as string | null | undefined) ?? null,
  }
  store.activities.push(row)
  return row
}

function insert(table: unknown) {
  return {
    values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
      const run = async (): Promise<Record<string, unknown>[]> => {
        if (table === schema.trips) {
          return [{ ...insertTrip(values as Record<string, unknown>) }]
        }
        if (table === schema.itineraryDays) {
          for (const day of values as Record<string, unknown>[]) {
            store.days.push({
              id: crypto.randomUUID(),
              tripId: String(day.tripId),
              dayNumber: Number(day.dayNumber),
              date: String(day.date),
            })
          }
          return []
        }
        if (table === schema.activities) {
          return [{ ...insertActivity(values as Record<string, unknown>) }]
        }
        assert.equal(table, schema.activityLog, "unexpected insert target")
        const entry = values as Record<string, unknown>
        store.log.push({
          tripId: String(entry.tripId),
          userId: String(entry.userId),
          action: String(entry.action),
          description: String(entry.description),
        })
        return []
      }
      return terminal(run, [])
    },
  }
}

function select() {
  return {
    from: (table: unknown) => ({
      where: async () => {
        if (table === schema.trips) {
          return [{ count: store.trips.filter((t) => t.userId === request.userId).length }]
        }
        assert.equal(table, schema.activities, "unexpected count target")
        return [
          {
            count: store.activities.filter((a) => a.itineraryDayId === request.itineraryDayId)
              .length,
          },
        ]
      },
    }),
  }
}

const original = {
  insert: db.insert,
  select: db.select,
  tripsFindFirst: db.query.trips.findFirst,
  membersFindFirst: db.query.tripMembers.findFirst,
  daysFindFirst: db.query.itineraryDays.findFirst,
  activitiesFindFirst: db.query.activities.findFirst,
  segmentsFindMany: db.query.travelSegments.findMany,
}

// drizzle's builder types are not constructible outside drizzle, so each fake
// is cast through `unknown` onto the method it replaces — the same approach
// expenses-routes.test.ts uses.
function installFakeDb(): void {
  db.insert = insert as unknown as typeof db.insert
  db.select = select as unknown as typeof db.select

  // Two callers with different shapes: `requireTripAccess` asks for columns,
  // `getTripWithRelations` asks for the nested day payload.
  db.query.trips.findFirst = (async (args?: { with?: unknown }) => {
    const trip = store.trips.find((t) => t.id === request.tripId)
    if (!trip) return undefined
    if (!args?.with) return { ...trip }
    return {
      ...trip,
      days: store.days
        .filter((d) => d.tripId === trip.id)
        .toSorted((a, b) => a.dayNumber - b.dayNumber)
        .map((d) => ({
          id: d.id,
          tripId: d.tripId,
          dayNumber: d.dayNumber,
          date: d.date,
          activities: store.activities
            .filter((a) => a.itineraryDayId === d.id)
            .toSorted((a, b) => a.sortOrder - b.sortOrder),
          travelSegments: store.segments.filter((s) => s.itineraryDayId === d.id),
        })),
    }
  }) as unknown as typeof db.query.trips.findFirst

  db.query.tripMembers.findFirst = (async () =>
    store.members.find(
      (m) => m.tripId === request.tripId && m.userId === request.userId && m.status === "active",
    )) as unknown as typeof db.query.tripMembers.findFirst

  // Both halves of the handler's `and(eq(id), eq(tripId))` are honoured: a day
  // belonging to another trip has to come back empty.
  db.query.itineraryDays.findFirst = (async () =>
    store.days.find(
      (d) => d.id === request.itineraryDayId && d.tripId === request.tripId,
    )) as unknown as typeof db.query.itineraryDays.findFirst

  db.query.activities.findFirst = (async () =>
    store.activities
      .filter((a) => a.itineraryDayId === request.itineraryDayId)
      .toSorted(
        (a, b) => b.sortOrder - a.sortOrder,
      )[0]) as unknown as typeof db.query.activities.findFirst

  db.query.travelSegments.findMany = (async () =>
    store.segments
      .filter((s) => s.itineraryDayId === request.itineraryDayId)
      .map((s) => structuredClone(s))) as unknown as typeof db.query.travelSegments.findMany
}

function restoreDb(): void {
  db.insert = original.insert
  db.select = original.select
  db.query.trips.findFirst = original.tripsFindFirst
  db.query.tripMembers.findFirst = original.membersFindFirst
  db.query.itineraryDays.findFirst = original.daysFindFirst
  db.query.activities.findFirst = original.activitiesFindFirst
  db.query.travelSegments.findMany = original.segmentsFindMany
}

installFakeDb()
process.on("exit", restoreDb)

// ---------------------------------------------------------------------------
// Call helpers
// ---------------------------------------------------------------------------

function callCreateTrip(userId: string, input: Partial<CreateTripInput> = {}) {
  request = { ...request, userId }
  return createTrip(userId, {
    countryCode: "JP",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    ...input,
  })
}

function callAddActivity(
  userId: string,
  tripId: string,
  input: Partial<AddActivityInput> = {},
  deps: AddActivityDeps = {},
) {
  const body: AddActivityInput = { itineraryDayId: DAY_ID, name: "Fushimi Inari", ...input }
  request = { userId, tripId, itineraryDayId: body.itineraryDayId }
  return addActivity(userId, tripId, body, {
    computeAndSaveSegments: async (dayId: string) => {
      segmentRuns.push(dayId)
    },
    getPlaceDetails: async () => {
      throw new Error("unexpected Place Details lookup")
    },
    deriveCostFromPlace: async () => {
      throw new Error("unexpected cost derivation")
    },
    ...deps,
  })
}

async function assertRejects(
  promise: Promise<unknown>,
  statusCode: number,
  message: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, statusCode)
    assert.equal((error as Error).message, message)
    return true
  })
}

// ---------------------------------------------------------------------------
// createTrip
// ---------------------------------------------------------------------------

describe("createTrip", () => {
  it("rejects a country code no country map entry backs", async () => {
    seed()
    await assertRejects(callCreateTrip(OWNER_ID, { countryCode: "ZZ" }), 400, "Unknown country")
    assert.deepEqual(store.trips, [])
  })

  it("rejects an end date before the start date", async () => {
    seed()
    await assertRejects(
      callCreateTrip(OWNER_ID, { startDate: "2026-09-03", endDate: "2026-09-01" }),
      400,
      "End date must be on or after start date",
    )
    assert.deepEqual(store.trips, [])
  })

  it(`rejects trip number ${TRIP_CAP + 1} for the same user`, async () => {
    seed({ trips: Array.from({ length: TRIP_CAP }, (_, i) => makeTrip({ id: `trip-${i}` })) })
    await assertRejects(
      callCreateTrip(OWNER_ID),
      400,
      `Maximum number of trips reached (${TRIP_CAP})`,
    )
    assert.equal(store.trips.length, TRIP_CAP)
  })

  it("counts only the caller's trips toward the cap", async () => {
    seed({
      trips: Array.from({ length: TRIP_CAP }, (_, i) =>
        makeTrip({ id: `trip-${i}`, userId: STRANGER_ID }),
      ),
    })
    await callCreateTrip(OWNER_ID)
    assert.equal(store.trips.filter((t) => t.userId === OWNER_ID).length, 1)
  })

  it("creates one itinerary day per date in the inclusive range", async () => {
    seed()
    await callCreateTrip(OWNER_ID, { startDate: "2026-09-01", endDate: "2026-09-03" })
    assert.deepEqual(
      store.days.map((d) => [d.dayNumber, d.date]),
      [
        [1, "2026-09-01"],
        [2, "2026-09-02"],
        [3, "2026-09-03"],
      ],
    )
    assert.equal(
      store.days.every((d) => d.tripId === store.trips[0]!.id),
      true,
    )
  })

  it("creates a single day for a same-day trip", async () => {
    seed()
    await callCreateTrip(OWNER_ID, { startDate: "2026-09-01", endDate: "2026-09-01" })
    assert.deepEqual(
      store.days.map((d) => d.date),
      ["2026-09-01"],
    )
  })

  it("falls back to the country name and currency for an unnamed trip", async () => {
    seed()
    await callCreateTrip(OWNER_ID)
    assert.partialDeepStrictEqual(store.trips[0], {
      destination: "Japan",
      name: null,
      countryCode: "JP",
      currencyCode: "JPY",
      preferences: {},
    })
  })

  it("uses the trimmed name as the destination and keeps an explicit currency", async () => {
    seed()
    await callCreateTrip(OWNER_ID, { name: "  Kyoto in autumn  ", currencyCode: "USD" })
    assert.partialDeepStrictEqual(store.trips[0], {
      destination: "Kyoto in autumn",
      name: "Kyoto in autumn",
      currencyCode: "USD",
    })
  })

  it("treats a whitespace-only name as no name", async () => {
    seed()
    await callCreateTrip(OWNER_ID, { name: "   " })
    assert.partialDeepStrictEqual(store.trips[0], { destination: "Japan", name: null })
  })

  it("returns the trip with its days attached", async () => {
    seed()
    const trip = await callCreateTrip(OWNER_ID, { startDate: "2026-09-01", endDate: "2026-09-02" })
    assert.equal(trip?.id, store.trips[0]!.id)
    assert.equal(trip?.days.length, 2)
  })

  // Locks in today's behaviour: creating a trip writes no audit row, unlike
  // every other trip mutation. A later change to that must be deliberate.
  it("writes no activity log row", async () => {
    seed()
    await callCreateTrip(OWNER_ID)
    assert.deepEqual(store.log, [])
  })
})

// ---------------------------------------------------------------------------
// addActivity
// ---------------------------------------------------------------------------

describe("addActivity", () => {
  it("lets the trip owner add an activity", async () => {
    seedTripWithDay()
    const { activity } = await callAddActivity(OWNER_ID, TRIP_ID)
    assert.equal(activity!.name, "Fushimi Inari")
    assert.equal(store.activities.length, 1)
  })

  it("lets an active editor add an activity", async () => {
    seedTripWithDay()
    await callAddActivity(EDITOR_ID, TRIP_ID)
    assert.equal(store.activities.length, 1)
  })

  it("refuses an active viewer with 403", async () => {
    seedTripWithDay()
    await assertRejects(
      callAddActivity(VIEWER_ID, TRIP_ID),
      403,
      "You don't have permission to do this",
    )
    assert.deepEqual(store.activities, [])
  })

  // A non-member gets 404 rather than 403: the trip's existence is itself
  // private, so the two are indistinguishable from outside.
  it("refuses a non-member with 404", async () => {
    seedTripWithDay()
    await assertRejects(callAddActivity(STRANGER_ID, TRIP_ID), 404, "Trip not found")
    assert.deepEqual(store.activities, [])
  })

  it("refuses a day that belongs to another trip with 404", async () => {
    seedTripWithDay({
      days: [
        { id: DAY_ID, tripId: TRIP_ID, dayNumber: 1, date: "2026-09-01" },
        { id: OTHER_DAY_ID, tripId: OTHER_TRIP_ID, dayNumber: 1, date: "2026-09-01" },
      ],
    })
    await assertRejects(
      callAddActivity(OWNER_ID, TRIP_ID, { itineraryDayId: OTHER_DAY_ID }),
      404,
      "Day not found",
    )
    assert.deepEqual(store.activities, [])
  })

  it(`rejects activity number ${ACTIVITY_CAP + 1} on a day`, async () => {
    seedTripWithDay({
      activities: Array.from({ length: ACTIVITY_CAP }, (_, i) => makeActivity({ sortOrder: i })),
    })
    await assertRejects(
      callAddActivity(OWNER_ID, TRIP_ID),
      400,
      `Maximum number of activities per day reached (${ACTIVITY_CAP})`,
    )
    assert.equal(store.activities.length, ACTIVITY_CAP)
  })

  it("appends after the day's highest sort order", async () => {
    seedTripWithDay({
      activities: [makeActivity({ sortOrder: 0 }), makeActivity({ sortOrder: 7 })],
    })
    const { activity } = await callAddActivity(OWNER_ID, TRIP_ID)
    assert.equal(activity!.sortOrder, 8)
  })

  it("starts an empty day at sort order 0", async () => {
    seedTripWithDay()
    const { activity } = await callAddActivity(OWNER_ID, TRIP_ID)
    assert.equal(activity!.sortOrder, 0)
  })

  it("writes an activity_added audit row naming the activity", async () => {
    seedTripWithDay()
    await callAddActivity(EDITOR_ID, TRIP_ID, { name: "Nishiki Market" })
    assert.deepEqual(store.log, [
      {
        tripId: TRIP_ID,
        userId: EDITOR_ID,
        action: "activity_added",
        description: 'Added "Nishiki Market" to Day',
      },
    ])
  })

  it("recomputes the day's segments and returns them", async () => {
    seedTripWithDay({ segments: [{ id: "seg-1", itineraryDayId: DAY_ID }] })
    const { segments } = await callAddActivity(OWNER_ID, TRIP_ID)
    assert.deepEqual(segmentRuns, [DAY_ID])
    assert.deepEqual(segments, [{ id: "seg-1", itineraryDayId: DAY_ID }])
  })

  it("derives a cost and backfills place details from a placeId alone", async () => {
    seedTripWithDay()
    const derived: string[] = []
    const { activity } = await callAddActivity(
      OWNER_ID,
      TRIP_ID,
      { name: "Kiyomizu-dera", placeId: "place-1" },
      {
        deriveCostFromPlace: async (placeId: string, tripCurrency: string) => {
          derived.push(`${placeId}:${tripCurrency}`)
          return "1500.00"
        },
        getPlaceDetails: async () => ({
          name: "Kiyomizu-dera",
          placeId: "place-1",
          lat: 34.99,
          lng: 135.78,
          rating: 4.5,
          openingHours: ["Monday: 6:00 AM – 6:00 PM"],
          priceLevel: 2,
        }),
      },
    )
    assert.deepEqual(derived, ["place-1:JPY"])
    assert.partialDeepStrictEqual(activity, {
      costEstimate: "1500.00",
      rating: "4.5",
      openingHours: ["Monday: 6:00 AM – 6:00 PM"],
      priceLevel: 2,
    })
  })

  it("keeps the client's cost and rating over Google's", async () => {
    seedTripWithDay()
    const { activity } = await callAddActivity(
      OWNER_ID,
      TRIP_ID,
      { placeId: "place-1", rating: 4.1, costEstimate: "900.00" },
      {
        getPlaceDetails: async () => ({
          name: "Fushimi Inari",
          placeId: "place-1",
          lat: 34.96,
          lng: 135.77,
          rating: 4.5,
          priceLevel: 1,
        }),
      },
    )
    assert.partialDeepStrictEqual(activity, { costEstimate: "900.00", rating: "4.1" })
  })

  it("stores no cost when Google has no price data", async () => {
    seedTripWithDay()
    const { activity } = await callAddActivity(
      OWNER_ID,
      TRIP_ID,
      { placeId: "place-1" },
      {
        deriveCostFromPlace: async () => null,
        getPlaceDetails: async () => null,
      },
    )
    assert.partialDeepStrictEqual(activity, { costEstimate: null, rating: null, priceLevel: null })
  })

  // A Place Details outage must not fail the write — the activity is the point,
  // the rating is a nicety.
  it("still inserts when the Place Details lookup throws", async () => {
    seedTripWithDay()
    const { activity } = await callAddActivity(
      OWNER_ID,
      TRIP_ID,
      { placeId: "place-1" },
      {
        deriveCostFromPlace: async () => null,
        getPlaceDetails: async () => {
          throw new Error("places api down")
        },
      },
    )
    assert.equal(activity!.name, "Fushimi Inari")
  })
})
