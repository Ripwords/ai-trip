/**
 * Route-level coverage for `server/api/trips/[id]/reservations/*` — issue #60.
 *
 * The four handlers had no tests at all, including the viewer redaction of
 * `confirmation_number`, which is security-relevant and was entirely unverified.
 * They are Nitro handlers, so they can't be imported without the auto-imported
 * globals (`defineEventHandler`, `readValidatedBody`, `requireAuth`, …); those
 * are installed below and the handlers are then imported dynamically — the same
 * shim-then-dynamic-import pattern as expenses-routes.test.ts.
 *
 * `requireTripAccess` and `logTripAction` are the *real* implementations so the
 * authz boundaries and the audit trail are genuinely exercised; everything they
 * touch is the fake database in this file.
 *
 * Fake-db limitations, deliberately kept simple: drizzle `where` clauses are
 * opaque objects here, so the fake resolves rows against the request recorded
 * by `makeEvent` rather than by interpreting SQL.
 */

// Never let this file reach a real database: the fake replaces every method it
// uses, but the connection string is overridden regardless.
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { describe, it } from "bun:test"

const { db } = await import("../db")
const schema = await import("../db/schema")
const { requireTripAccess, logTripAction } = await import("../utils/trip-access")

const TRIP_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_TRIP_ID = "22222222-2222-4222-8222-222222222222"
const RESERVATION_ID = "33333333-3333-4333-8333-333333333333"
const STAY_ID = "44444444-4444-4444-8444-444444444444"
const DAY_ID = "55555555-5555-4555-8555-555555555555"
const LATER_DAY_ID = "66666666-6666-4666-8666-666666666666"
const OWNER_ID = "user-owner"
const EDITOR_ID = "user-editor"
const VIEWER_ID = "user-viewer"
const STRANGER_ID = "user-stranger"

interface ReservationRow {
  id: string
  tripId: string
  type: string
  source: string
  stayId: string | null
  detachedAt: Date | null
  status: string
  name: string
  confirmationNumber: string | null
  provider: string | null
  notes: string | null
  startDate: Date | null
  endDate: Date | null
  amount: string | null
  createdById: string | null
}

interface DayRow {
  id: string
  tripId: string
  stayId: string | null
  date: string
}

interface TripRow {
  id: string
  userId: string
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

interface Store {
  trips: TripRow[]
  reservations: ReservationRow[]
  days: DayRow[]
  members: MemberRow[]
  log: LogRow[]
}

/** Which trip/reservation/user the in-flight request is about — see the note above. */
interface CurrentRequest {
  tripId: string
  reservationId: string
  userId: string
}

let store: Store = emptyStore()
let request: CurrentRequest = { tripId: TRIP_ID, reservationId: RESERVATION_ID, userId: OWNER_ID }

function emptyStore(): Store {
  return { trips: [], reservations: [], days: [], members: [], log: [] }
}

function seed(overrides: Partial<Store> = {}): void {
  store = {
    ...emptyStore(),
    trips: [
      { id: TRIP_ID, userId: OWNER_ID },
      { id: OTHER_TRIP_ID, userId: OWNER_ID },
    ],
    members: [
      { tripId: TRIP_ID, userId: EDITOR_ID, role: "editor", status: "active" },
      { tripId: TRIP_ID, userId: VIEWER_ID, role: "viewer", status: "active" },
    ],
    ...overrides,
  }
}

function makeReservation(overrides: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id: RESERVATION_ID,
    tripId: TRIP_ID,
    type: "accommodation",
    source: "manual",
    stayId: null,
    detachedAt: null,
    status: "confirmed",
    name: "Hotel Nikko",
    confirmationNumber: "ABC123",
    provider: "Booking.com",
    notes: null,
    startDate: new Date("2026-03-22T00:00:00.000Z"),
    endDate: new Date("2026-03-25T00:00:00.000Z"),
    amount: "900.00",
    createdById: OWNER_ID,
    ...overrides,
  }
}

/** A booking mirrored from a stay, with the gaps the user still has to fill. */
function makeDerived(overrides: Partial<ReservationRow> = {}): ReservationRow {
  return makeReservation({
    source: "stay",
    stayId: STAY_ID,
    confirmationNumber: null,
    provider: null,
    amount: null,
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

// ---------------------------------------------------------------------------
// `where` interpretation
//
// A fake whose `update` ignores its `where` and just rewrites "the row this
// request is about" will pass whatever the handler targets — including the
// wrong row. Drizzle's `eq()` flattens to a chunk list of
// `Column, " = ", Param`, so the equalities are readable, and the fake resolves
// rows against them like the database would.
// ---------------------------------------------------------------------------

/** `reservations` DB column name → the key on `ReservationRow`. */
const COLUMN_TO_FIELD: Record<string, keyof ReservationRow> = {
  id: "id",
  trip_id: "tripId",
  stay_id: "stayId",
  type: "type",
  source: "source",
  status: "status",
  name: "name",
}

interface ChunkNode {
  queryChunks?: unknown[]
  name?: string
  value?: unknown
}

function equalitiesIn(clause: unknown): { column: string; value: unknown }[] {
  const found: { column: string; value: unknown }[] = []
  let pendingColumn: string | null = null

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (!node || typeof node !== "object") return
    const n = node as ChunkNode
    if (Array.isArray(n.queryChunks)) {
      walk(n.queryChunks)
      return
    }
    const kind = node.constructor?.name ?? ""
    if (typeof n.name === "string" && kind !== "StringChunk") {
      pendingColumn = n.name
      return
    }
    if (kind === "Param" && pendingColumn) {
      found.push({ column: pendingColumn, value: n.value })
      pendingColumn = null
    }
  }

  walk(clause)
  return found
}

/** Every equality in the clause must hold — the fake's stand-in for `AND`. */
function matchesWhere(row: ReservationRow, clause: unknown): boolean {
  const equalities = equalitiesIn(clause)
  assert.ok(equalities.length > 0, "a write must be scoped by a where clause the fake understands")
  return equalities.every(({ column, value }) => {
    const field = COLUMN_TO_FIELD[column]
    assert.ok(field, `unmapped column in a reservations where clause: ${column}`)
    return row[field] === value
  })
}

function makeClient() {
  const insert = (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      const run = async (): Promise<ReservationRow[]> => {
        if (table !== schema.reservations) {
          store.log.push(values as unknown as LogRow)
          return []
        }
        const row: ReservationRow = {
          id: crypto.randomUUID(),
          tripId: String(values.tripId),
          type: (values.type as string) ?? "other",
          // Mirrors the column default: anything the route inserts without
          // saying otherwise is a hand-typed booking.
          source: (values.source as string) ?? "manual",
          stayId: (values.stayId as string | null) ?? null,
          detachedAt: (values.detachedAt as Date | null) ?? null,
          status: (values.status as string) ?? "confirmed",
          name: String(values.name),
          confirmationNumber: (values.confirmationNumber as string | null) ?? null,
          provider: (values.provider as string | null) ?? null,
          notes: (values.notes as string | null) ?? null,
          startDate: (values.startDate as Date | null) ?? null,
          endDate: (values.endDate as Date | null) ?? null,
          amount: (values.amount as string | null) ?? null,
          createdById: (values.createdById as string | null) ?? null,
        }
        store.reservations.push(row)
        return [{ ...row }]
      }
      return terminal(run, [])
    },
  })

  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: (clause: unknown) =>
        terminal(async (): Promise<ReservationRow[]> => {
          const row = store.reservations.find((r) => matchesWhere(r, clause))
          if (!row) return []
          Object.assign(row, values)
          return [{ ...row }]
        }, []),
    }),
  })

  const del = () => ({
    where: async (clause: unknown) => {
      const index = store.reservations.findIndex((r) => matchesWhere(r, clause))
      if (index >= 0) store.reservations.splice(index, 1)
    },
  })

  // The one `select` in these routes resolves each linked stay's first night,
  // so a derived row's "Edit in itinerary" link lands on the right day.
  const select = () => ({
    from: (table: unknown) => {
      assert.equal(table, schema.itineraryDays, "the only select here is the stay→day lookup")
      const linkedStayIds = new Set(
        store.reservations.flatMap((r) =>
          r.tripId === request.tripId && r.stayId ? [r.stayId] : [],
        ),
      )
      const rows = store.days
        .filter((d) => d.stayId && linkedStayIds.has(d.stayId))
        .map((d) => ({ id: d.id, stayId: d.stayId, date: d.date }))
      return {
        where: () => ({
          orderBy: async () => rows.toSorted((a, b) => a.date.localeCompare(b.date)),
        }),
      }
    },
  })

  return { insert, update, delete: del, select }
}

const original = {
  insert: db.insert,
  update: db.update,
  delete: db.delete,
  select: db.select,
  tripsFindFirst: db.query.trips.findFirst,
  membersFindFirst: db.query.tripMembers.findFirst,
  reservationsFindFirst: db.query.reservations.findFirst,
  reservationsFindMany: db.query.reservations.findMany,
}

// drizzle's builder types are not constructible outside drizzle, so each fake
// is cast through `unknown` onto the method it replaces.
function installFakeDb(): void {
  const root = makeClient()
  db.insert = root.insert as unknown as typeof db.insert
  db.update = root.update as unknown as typeof db.update
  db.delete = root.delete as unknown as typeof db.delete
  db.select = root.select as unknown as typeof db.select

  db.query.trips.findFirst = (async () =>
    store.trips.find((t) => t.id === request.tripId)) as unknown as typeof db.query.trips.findFirst

  db.query.tripMembers.findFirst = (async () =>
    store.members.find(
      (m) => m.tripId === request.tripId && m.userId === request.userId && m.status === "active",
    )) as unknown as typeof db.query.tripMembers.findFirst

  // Rows are copied on the way out: a real query returns a snapshot, and the
  // redaction test depends on the handler not mutating the stored row.
  db.query.reservations.findFirst = (async () => {
    const row = store.reservations.find(
      (r) => r.id === request.reservationId && r.tripId === request.tripId,
    )
    return row ? { ...row } : undefined
  }) as unknown as typeof db.query.reservations.findFirst

  db.query.reservations.findMany = (async () =>
    store.reservations
      .filter((r) => r.tripId === request.tripId)
      .toSorted((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0))
      .map((r) => ({ ...r }))) as unknown as typeof db.query.reservations.findMany
}

// ---------------------------------------------------------------------------
// Nitro globals
// ---------------------------------------------------------------------------

interface FakeEvent {
  context: { params: Record<string, string>; body: unknown; userId: string | null }
}

type Validate<T> = (input: unknown) => T

interface NitroGlobals {
  defineEventHandler?: unknown
  getValidatedRouterParams?: unknown
  readValidatedBody?: unknown
  readBody?: unknown
  requireAuth?: unknown
  requireTripAccess?: unknown
  logTripAction?: unknown
}

const globals = globalThis as NitroGlobals

globals.defineEventHandler = (handler: unknown) => handler

globals.getValidatedRouterParams = async <T>(event: FakeEvent, validate: Validate<T>) =>
  validated(() => validate(event.context.params))

globals.readValidatedBody = async <T>(event: FakeEvent, validate: Validate<T>) =>
  validated(() => validate(event.context.body))

globals.readBody = async (event: FakeEvent) => event.context.body

/** Nitro turns a validation throw into a 400; the raw zod error is not the
 *  behaviour under test, the status code is. */
function validated<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    throw createError({
      statusCode: 400,
      message: error instanceof Error ? error.message : "Bad Request",
    })
  }
}

globals.requireAuth = async (event: FakeEvent) => {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: "Unauthorized" })
  return { user: { id: userId } }
}

globals.requireTripAccess = requireTripAccess
globals.logTripAction = logTripAction

installFakeDb()

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type Handler<T> = (event: FakeEvent) => Promise<T>

/** What GET returns: the row plus the server-computed booking gaps. */
type ListedReservation = ReservationRow & {
  missingFields: string[]
  itineraryDayId: string | null
}

// `defineEventHandler` is the identity stub above, so the default export is the
// raw handler; its declared `EventHandler` type describes the Nitro-wrapped
// form, hence the cast.
const listReservations = (await import("../api/trips/[id]/reservations/index.get"))
  .default as unknown as Handler<ListedReservation[]>
const createReservation = (await import("../api/trips/[id]/reservations/index.post"))
  .default as unknown as Handler<ReservationRow | undefined>
const updateReservation = (await import("../api/trips/[id]/reservations/[reservationId].put"))
  .default as unknown as Handler<ReservationRow | undefined>
const deleteReservation = (await import("../api/trips/[id]/reservations/[reservationId].delete"))
  .default as unknown as Handler<{ success: boolean }>

interface EventOptions {
  userId?: string | null
  tripId?: string
  reservationId?: string
  body?: unknown
}

function makeEvent(options: EventOptions = {}): FakeEvent {
  const tripId = options.tripId ?? TRIP_ID
  const reservationId = options.reservationId ?? RESERVATION_ID
  const userId = options.userId === undefined ? OWNER_ID : options.userId
  request = { tripId, reservationId, userId: userId ?? "" }
  return {
    context: { params: { id: tripId, reservationId }, body: options.body, userId },
  }
}

/** Assert a handler rejected with a specific HTTP status. */
async function assertStatus(promise: Promise<unknown>, statusCode: number): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, statusCode)
    return true
  })
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "restaurant", name: "Narisawa", ...overrides }
}

// ---------------------------------------------------------------------------
// GET /api/trips/:id/reservations
// ---------------------------------------------------------------------------

describe("GET reservations", () => {
  it("returns the trip's reservations by start date", async () => {
    seed({
      reservations: [
        makeReservation({ id: "late", startDate: new Date("2026-03-30T00:00:00.000Z") }),
        makeReservation({ id: "early", startDate: new Date("2026-03-01T00:00:00.000Z") }),
      ],
    })
    const result = await listReservations(makeEvent())
    assert.deepEqual(
      result.map((r) => r.id),
      ["early", "late"],
    )
  })

  it("never returns another trip's reservations", async () => {
    seed({ reservations: [makeReservation({ id: "other", tripId: OTHER_TRIP_ID })] })
    assert.equal((await listReservations(makeEvent())).length, 0)
  })

  // Security-relevant and previously unverified: a confirmation number is
  // often enough to modify or cancel a booking on the provider's site.
  it("redacts the confirmation number for a viewer", async () => {
    seed({ reservations: [makeReservation()] })
    const [row] = await listReservations(makeEvent({ userId: VIEWER_ID }))
    assert.equal(row?.confirmationNumber, null)
  })

  it("shows the confirmation number to an editor and to the owner", async () => {
    seed({ reservations: [makeReservation()] })
    for (const userId of [OWNER_ID, EDITOR_ID]) {
      const [row] = await listReservations(makeEvent({ userId }))
      assert.equal(row?.confirmationNumber, "ABC123")
    }
  })

  it("redacting for a viewer does not destroy the stored value", async () => {
    seed({ reservations: [makeReservation()] })
    await listReservations(makeEvent({ userId: VIEWER_ID }))
    assert.equal(store.reservations[0]?.confirmationNumber, "ABC123")
  })

  it("reports the gaps a derived booking still needs", async () => {
    seed({ reservations: [makeDerived()] })
    const [row] = await listReservations(makeEvent())
    assert.deepEqual(row?.missingFields, ["confirmationNumber", "provider", "amount"])
  })

  it("reports no gaps once the user has filled them in", async () => {
    seed({
      reservations: [
        makeDerived({ confirmationNumber: "PNR1", provider: "Booking.com", amount: "900.00" }),
      ],
    })
    const [row] = await listReservations(makeEvent())
    assert.deepEqual(row?.missingFields, [])
  })

  it("points a derived row at the first night of its stay", async () => {
    seed({
      reservations: [makeDerived()],
      days: [
        { id: LATER_DAY_ID, tripId: TRIP_ID, stayId: STAY_ID, date: "2026-03-23" },
        { id: DAY_ID, tripId: TRIP_ID, stayId: STAY_ID, date: "2026-03-22" },
      ],
    })
    const [row] = await listReservations(makeEvent())
    assert.equal(row?.itineraryDayId, DAY_ID)
  })

  it("leaves a manual row with no itinerary day to jump to", async () => {
    seed({ reservations: [makeReservation()], days: [] })
    const [row] = await listReservations(makeEvent())
    assert.equal(row?.itineraryDayId, null)
  })

  it("rejects an unauthenticated request", async () => {
    seed()
    await assertStatus(listReservations(makeEvent({ userId: null })), 401)
  })

  it("404s for a user who is not a member, without leaking the trip's existence", async () => {
    seed({ reservations: [makeReservation()] })
    await assertStatus(listReservations(makeEvent({ userId: STRANGER_ID })), 404)
  })

  it("rejects a non-uuid trip id", async () => {
    seed()
    await assertStatus(listReservations(makeEvent({ tripId: "not-a-uuid" })), 400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/trips/:id/reservations
// ---------------------------------------------------------------------------

describe("POST reservations", () => {
  it("creates a reservation for the owner", async () => {
    seed()
    const created = await createReservation(makeEvent({ body: validBody() }))
    assert.equal(created?.name, "Narisawa")
    assert.equal(store.reservations.length, 1)
  })

  it("lets an editor add one", async () => {
    seed()
    await createReservation(makeEvent({ userId: EDITOR_ID, body: validBody() }))
    assert.equal(store.reservations.length, 1)
  })

  it("403s for a viewer", async () => {
    seed()
    await assertStatus(createReservation(makeEvent({ userId: VIEWER_ID, body: validBody() })), 403)
    assert.equal(store.reservations.length, 0)
  })

  it("404s for a non-member", async () => {
    seed()
    await assertStatus(
      createReservation(makeEvent({ userId: STRANGER_ID, body: validBody() })),
      404,
    )
    assert.equal(store.reservations.length, 0)
  })

  // Hand-typed bookings must never claim to be derived: `source` is what the
  // UI trusts when it decides which fields to prompt for.
  it("creates a manual row that the client cannot talk out of", async () => {
    seed()
    await createReservation(makeEvent({ body: validBody({ source: "stay", stayId: STAY_ID }) }))
    assert.equal(store.reservations[0]?.source, "manual")
    assert.equal(store.reservations[0]?.stayId, null)
  })

  it("audits the creation", async () => {
    seed()
    await createReservation(makeEvent({ body: validBody() }))
    const entry = store.log.at(-1)
    assert.equal(entry?.action, "reservation_added")
    assert.match(entry?.description ?? "", /Narisawa/)
  })

  it("stores the dates it was given", async () => {
    seed()
    await createReservation(
      makeEvent({
        body: validBody({
          startDate: "2026-03-22T18:00:00.000Z",
          endDate: "2026-03-22T21:00:00.000Z",
        }),
      }),
    )
    assert.deepEqual(store.reservations[0]?.startDate, new Date("2026-03-22T18:00:00.000Z"))
  })

  it("rejects a type outside the enum", async () => {
    seed()
    await assertStatus(createReservation(makeEvent({ body: validBody({ type: "yacht" }) })), 400)
  })

  it("rejects a status outside the enum", async () => {
    seed()
    await assertStatus(createReservation(makeEvent({ body: validBody({ status: "maybe" }) })), 400)
  })

  it("rejects an empty name", async () => {
    seed()
    await assertStatus(createReservation(makeEvent({ body: validBody({ name: "" }) })), 400)
  })

  // `amount` was a plain z.string(): "abc" reached Postgres as an unhandled
  // 500, and "-50" persisted and silently corrupted every total that summed it.
  it("rejects amounts Postgres numeric would choke on", async () => {
    for (const amount of ["-50", "abc", "1e40", "12.345"]) {
      seed()
      await assertStatus(createReservation(makeEvent({ body: validBody({ amount }) })), 400)
      assert.equal(store.reservations.length, 0, `${amount} must not persist`)
    }
  })

  it("accepts a well-formed amount", async () => {
    seed()
    await createReservation(makeEvent({ body: validBody({ amount: "900.00" }) }))
    assert.equal(store.reservations[0]?.amount, "900.00")
  })

  it("rejects a check-out that precedes its check-in", async () => {
    seed()
    await assertStatus(
      createReservation(
        makeEvent({
          body: validBody({
            type: "accommodation",
            startDate: "2026-03-25T00:00:00.000Z",
            endDate: "2026-03-22T00:00:00.000Z",
          }),
        }),
      ),
      400,
    )
  })
})

// ---------------------------------------------------------------------------
// PUT /api/trips/:id/reservations/:reservationId
// ---------------------------------------------------------------------------

describe("PUT reservations", () => {
  it("updates a manual reservation", async () => {
    seed({ reservations: [makeReservation()] })
    await updateReservation(makeEvent({ body: { name: "Sushi Saito" } }))
    assert.equal(store.reservations[0]?.name, "Sushi Saito")
  })

  it("403s for a viewer", async () => {
    seed({ reservations: [makeReservation()] })
    await assertStatus(
      updateReservation(makeEvent({ userId: VIEWER_ID, body: { name: "Nope" } })),
      403,
    )
    assert.equal(store.reservations[0]?.name, "Hotel Nikko")
  })

  it("404s for a reservation belonging to another trip", async () => {
    seed({ reservations: [makeReservation({ tripId: OTHER_TRIP_ID })] })
    await assertStatus(updateReservation(makeEvent({ body: { name: "Nope" } })), 404)
  })

  it("404s for a reservation that does not exist", async () => {
    seed({ reservations: [] })
    await assertStatus(updateReservation(makeEvent({ body: { name: "Nope" } })), 404)
  })

  it("rejects an amount Postgres numeric would choke on", async () => {
    seed({ reservations: [makeReservation()] })
    await assertStatus(updateReservation(makeEvent({ body: { amount: "-50" } })), 400)
    assert.equal(store.reservations[0]?.amount, "900.00")
  })

  it("clears a date when sent an explicit null", async () => {
    seed({ reservations: [makeReservation()] })
    await updateReservation(makeEvent({ body: { endDate: null } }))
    assert.equal(store.reservations[0]?.endDate, null)
  })

  // The linkage's whole point: the hotel and its nights belong to the stay, so
  // a derived row's card must not be able to rewrite them.
  it("409s when a derived row is sent a mirrored field", async () => {
    for (const field of ["name", "type", "startDate", "endDate"]) {
      seed({ reservations: [makeDerived()] })
      await assertStatus(
        updateReservation(makeEvent({ body: { [field]: "2026-01-01T00:00:00.000Z" } })),
        409,
      )
      assert.equal(store.reservations[0]?.name, "Hotel Nikko")
    }
  })

  it("accepts the gap fields on a derived row", async () => {
    seed({ reservations: [makeDerived()] })
    await updateReservation(
      makeEvent({
        body: {
          confirmationNumber: "PNR1",
          provider: "Booking.com",
          amount: "900.00",
          status: "pending",
          notes: "Late check-in",
        },
      }),
    )
    const row = store.reservations[0]
    assert.equal(row?.confirmationNumber, "PNR1")
    assert.equal(row?.provider, "Booking.com")
    assert.equal(row?.amount, "900.00")
    assert.equal(row?.status, "pending")
  })

  it("still validates the amount on a derived row", async () => {
    seed({ reservations: [makeDerived()] })
    await assertStatus(updateReservation(makeEvent({ body: { amount: "abc" } })), 400)
  })

  // A detached row is the user's again — its stay went away, but it is a
  // normal manual booking now and its name is editable.
  it("lets a detached row edit its name again", async () => {
    seed({
      reservations: [
        makeDerived({ source: "manual", stayId: null, detachedAt: new Date("2026-04-01") }),
      ],
    })
    await updateReservation(makeEvent({ body: { name: "Hotel Nikko (cancelled)" } }))
    assert.equal(store.reservations[0]?.name, "Hotel Nikko (cancelled)")
  })

  // `stay_id` is `ON DELETE SET NULL`, so a stay removed by anything other than
  // `reconcileTripStays` leaves `source = 'stay'` pointing at nothing. Treating
  // that as derived made the row permanently uneditable — a 409 on every field
  // the stay owns, for a stay that no longer exists.
  it("lets a row whose stay vanished be edited like a manual one", async () => {
    seed({ reservations: [makeDerived({ stayId: null })] })
    await updateReservation(makeEvent({ body: { name: "Hotel Nikko" } }))
    assert.equal(store.reservations[0]?.name, "Hotel Nikko")
  })

  // `datesInOrder` only fires when the body carries BOTH dates, and the
  // Bookings form sends one field at a time — so this comparison against the
  // stored row is the only thing standing between the sort and nonsense.
  it("rejects an end date sent alone that precedes the stored start date", async () => {
    seed({ reservations: [makeReservation()] })
    await assertStatus(
      updateReservation(makeEvent({ body: { endDate: "2026-03-01T00:00:00.000Z" } })),
      400,
    )
    assert.deepEqual(store.reservations[0]?.endDate, new Date("2026-03-25T00:00:00.000Z"))
  })

  it("rejects a start date sent alone that follows the stored end date", async () => {
    seed({ reservations: [makeReservation()] })
    await assertStatus(
      updateReservation(makeEvent({ body: { startDate: "2026-04-30T00:00:00.000Z" } })),
      400,
    )
    assert.deepEqual(store.reservations[0]?.startDate, new Date("2026-03-22T00:00:00.000Z"))
  })

  it("accepts a lone end date that still follows the stored start date", async () => {
    seed({ reservations: [makeReservation()] })
    await updateReservation(makeEvent({ body: { endDate: "2026-03-28T00:00:00.000Z" } }))
    assert.deepEqual(store.reservations[0]?.endDate, new Date("2026-03-28T00:00:00.000Z"))
  })

  it("accepts a lone end date when the stored start date is null", async () => {
    seed({ reservations: [makeReservation({ startDate: null })] })
    await updateReservation(makeEvent({ body: { endDate: "2026-03-28T00:00:00.000Z" } }))
    assert.deepEqual(store.reservations[0]?.endDate, new Date("2026-03-28T00:00:00.000Z"))
  })

  it("writes only the row it targeted", async () => {
    seed({
      reservations: [
        makeReservation(),
        makeReservation({ id: "other-row", name: "Ryokan Asaba", amount: "100.00" }),
      ],
    })
    await updateReservation(makeEvent({ body: { amount: "42.00" } }))
    assert.equal(store.reservations[0]?.amount, "42.00")
    assert.equal(store.reservations[1]?.amount, "100.00")
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/trips/:id/reservations/:reservationId
// ---------------------------------------------------------------------------

describe("DELETE reservations", () => {
  it("deletes a reservation", async () => {
    seed({ reservations: [makeReservation()] })
    const result = await deleteReservation(makeEvent())
    assert.equal(result.success, true)
    assert.equal(store.reservations.length, 0)
  })

  it("403s for a viewer", async () => {
    seed({ reservations: [makeReservation()] })
    await assertStatus(deleteReservation(makeEvent({ userId: VIEWER_ID })), 403)
    assert.equal(store.reservations.length, 1)
  })

  it("404s for a reservation belonging to another trip", async () => {
    seed({ reservations: [makeReservation({ tripId: OTHER_TRIP_ID })] })
    await assertStatus(deleteReservation(makeEvent()), 404)
    assert.equal(store.reservations.length, 1)
  })

  it("404s for a non-member", async () => {
    seed({ reservations: [makeReservation()] })
    await assertStatus(deleteReservation(makeEvent({ userId: STRANGER_ID })), 404)
    assert.equal(store.reservations.length, 1)
  })

  // Deleting a derived row destroys the user's confirmation number and amount
  // and achieves nothing else: the stay is still there, so the next reconcile
  // mirrors a fresh blank booking straight back. The row resurrects; the money
  // does not.
  it("409s on a derived row rather than letting it resurrect blank", async () => {
    seed({ reservations: [makeDerived({ amount: "900.00", confirmationNumber: "PNR1" })] })
    await assertStatus(deleteReservation(makeEvent()), 409)
    assert.equal(store.reservations.length, 1)
    assert.equal(store.reservations[0]?.amount, "900.00")
  })

  it("deletes a detached row — its stay is gone, so nothing recreates it", async () => {
    seed({
      reservations: [
        makeDerived({ source: "manual", stayId: null, detachedAt: new Date("2026-04-01") }),
      ],
    })
    assert.equal((await deleteReservation(makeEvent())).success, true)
    assert.equal(store.reservations.length, 0)
  })

  // The `ON DELETE SET NULL` orphan: `source` still says 'stay' but there is no
  // stay to clear the accommodation on, so refusing would strand the row.
  it("deletes a row whose stay vanished", async () => {
    seed({ reservations: [makeDerived({ stayId: null })] })
    assert.equal((await deleteReservation(makeEvent())).success, true)
    assert.equal(store.reservations.length, 0)
  })

  it("deletes only the row it targeted", async () => {
    seed({ reservations: [makeReservation(), makeReservation({ id: "other-row" })] })
    await deleteReservation(makeEvent())
    assert.deepEqual(
      store.reservations.map((r) => r.id),
      ["other-row"],
    )
  })
})

// ---------------------------------------------------------------------------
// confirmation_number encryption
// ---------------------------------------------------------------------------

describe("confirmationNumber encryption", () => {
  // The fake db above stores plaintext, so the `encryptedText` mapping is
  // exercised directly off the column — it is the only thing standing between
  // a confirmation number and a plaintext database dump.
  const column = schema.reservations.confirmationNumber

  it("round-trips through the column's driver mapping", () => {
    const stored = column.mapToDriverValue("ABC123") as string
    assert.notEqual(stored, "ABC123", "the value must not reach the driver in plaintext")
    assert.equal(column.mapFromDriverValue(stored), "ABC123")
  })

  it("produces a different ciphertext each time, so equal PNRs aren't linkable", () => {
    assert.notEqual(column.mapToDriverValue("ABC123"), column.mapToDriverValue("ABC123"))
  })

  it("refuses to decrypt a tampered ciphertext rather than returning garbage", () => {
    const stored = column.mapToDriverValue("ABC123") as string
    const tampered = `${stored.slice(0, -4)}AAAA`
    assert.throws(() => column.mapFromDriverValue(tampered))
  })
})
