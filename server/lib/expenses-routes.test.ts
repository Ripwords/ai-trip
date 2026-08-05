/**
 * Route-level coverage for `server/api/trips/[id]/expenses/*` — issue #50.
 *
 * The four handlers had no tests at all, which is how the missing ownership
 * check on PUT, the `z.string()` amount and the UTC date shift all shipped.
 * They are Nitro handlers, so they can't be imported without the auto-imported
 * globals (`defineEventHandler`, `readValidatedBody`, `requireAuth`, …); those
 * are installed below and the handlers are then imported dynamically, the same
 * shim-then-dynamic-import pattern as ai-tools.test.ts.
 *
 * `requireTripAccess` and `logTripAction` are the *real* implementations so the
 * authz boundaries and the audit trail are genuinely exercised; everything they
 * touch is the fake database in this file.
 *
 * Fake-db limitations, deliberately kept simple: drizzle `where` clauses are
 * opaque objects here, so the fake resolves rows against the request recorded
 * by `makeEvent` rather than by interpreting SQL. Concurrency tests therefore
 * use a single trip and a single user.
 */

// Never let this file reach a real database: the fake replaces every method it
// uses, but the connection string is overridden regardless.
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { afterEach, describe, it } from "bun:test"

const { db } = await import("../db")
const schema = await import("../db/schema")
const { requireTripAccess, logTripAction } = await import("../utils/trip-access")

/** The cap issue #42 is about. Duplicated here on purpose: the test asserts the
 *  externally-observable limit, not whatever constant the implementation uses. */
const EXPENSE_CAP = 200

const TRIP_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_TRIP_ID = "22222222-2222-4222-8222-222222222222"
const EXPENSE_ID = "33333333-3333-4333-8333-333333333333"
const ACTIVITY_ID = "44444444-4444-4444-8444-444444444444"
const OWNER_ID = "user-owner"
const EDITOR_ID = "user-editor"
const VIEWER_ID = "user-viewer"
const STRANGER_ID = "user-stranger"

interface ExpenseRow {
  id: string
  tripId: string
  activityId: string | null
  description: string
  /** Denominated in the trip's currency. */
  amount: string
  category: string
  paidById: string | null
  paidAt: string | null
  /** How `splits` was derived (#35). */
  splitMode: string
  /** Resolved per-participant amounts; null = equal across everyone. */
  splits: Record<string, string> | null
  createdAt: Date
}

interface TripRow {
  id: string
  userId: string
  currencyCode: string
  /** The owner's user row, joined by `listSettlementMembers`. */
  user: { id: string; name: string }
  /** The counter the fix in #42 introduces. Harmless while unused. */
  expenseCount: number
}

interface MemberRow {
  tripId: string
  userId: string
  role: "editor" | "viewer"
  status: "active" | "pending"
  user: { id: string; name: string }
}

interface ActivityRow {
  id: string
  day: { tripId: string }
}

interface LogRow {
  tripId: string
  userId: string
  action: string
  description: string
  metadata?: Record<string, unknown>
}

interface Store {
  trips: TripRow[]
  expenses: ExpenseRow[]
  members: MemberRow[]
  activities: ActivityRow[]
  log: LogRow[]
}

/** Which trip/expense/user the in-flight request is about — see the note above. */
interface CurrentRequest {
  tripId: string
  expenseId: string
  userId: string
  activityId?: string
}

let store: Store = emptyStore()
/** Every database operation the handler under test performed, in order. */
let ops: string[] = []
let request: CurrentRequest = { tripId: TRIP_ID, expenseId: EXPENSE_ID, userId: OWNER_ID }

function emptyStore(): Store {
  return { trips: [], expenses: [], members: [], activities: [], log: [] }
}

function seed(overrides: Partial<Store> = {}): void {
  store = {
    ...emptyStore(),
    trips: [
      {
        id: TRIP_ID,
        userId: OWNER_ID,
        currencyCode: "JPY",
        user: { id: OWNER_ID, name: "Olivia Owner" },
        expenseCount: 0,
      },
    ],
    members: [
      {
        tripId: TRIP_ID,
        userId: EDITOR_ID,
        role: "editor",
        status: "active",
        user: { id: EDITOR_ID, name: "Eddie Editor" },
      },
      {
        tripId: TRIP_ID,
        userId: VIEWER_ID,
        role: "viewer",
        status: "active",
        user: { id: VIEWER_ID, name: "Vera Viewer" },
      },
    ],
    ...overrides,
  }
  ops = []
}

function makeExpense(overrides: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    id: EXPENSE_ID,
    tripId: TRIP_ID,
    activityId: null,
    description: "Ramen",
    amount: "12.00",
    category: "food",
    paidById: null,
    paidAt: "2026-08-04",
    splitMode: "equal",
    splits: null,
    createdAt: new Date("2026-08-04T00:00:00Z"),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fake database
// ---------------------------------------------------------------------------

/** A per-trip mutex modelling the row lock an `UPDATE trips …` takes: the
 *  second writer waits for the first transaction to commit. */
function createMutex() {
  let tail: Promise<void> = Promise.resolve()
  return async function acquire(): Promise<() => void> {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = tail
    tail = tail.then(() => held)
    await previous
    return release
  }
}

const tripLock = createMutex()

interface TxContext {
  /** Locks held until the transaction commits or rolls back. */
  held: Array<() => void>
  inTransaction: boolean
}

const autocommit: TxContext = { held: [], inTransaction: false }

/** Take the trip row lock. Inside a transaction it is held until commit or
 *  rollback; outside one it is released as soon as the statement finishes. */
async function lockTrip(ctx: TxContext): Promise<void> {
  ctx.held.push(await tripLock())
}

function releaseAll(ctx: TxContext): void {
  for (const release of ctx.held.splice(0)) release()
}

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

function tripsUpdate(ctx: TxContext, set: Record<string, unknown>): Terminal<TripRow[]> {
  // The reserve path reads the new count back (`.returning()`); the release
  // path on delete does not. That is how the fake tells the two apart without
  // interpreting the `expense_count ± 1` SQL fragment.
  const trip = () => store.trips.find((t) => t.id === request.tripId)

  const reserve = async (): Promise<TripRow[]> => {
    ops.push("update trips (reserve slot)")
    await lockTrip(ctx)
    if (!ctx.inTransaction) releaseAll(ctx)
    const row = trip()
    if (!row) return []
    // Models both the `WHERE expense_count < cap` guard and the CHECK
    // constraint: the database, not the caller, refuses to go over.
    if (row.expenseCount >= EXPENSE_CAP) return []
    row.expenseCount += 1
    return [{ ...row }]
  }

  const release = async (): Promise<TripRow[]> => {
    ops.push("update trips (release slot)")
    await lockTrip(ctx)
    if (!ctx.inTransaction) releaseAll(ctx)
    const row = trip()
    if (row) row.expenseCount = Math.max(0, row.expenseCount - 1)
    return row ? [{ ...row }] : []
  }

  assert.ok("expenseCount" in set, "the only trips update in the expense routes is the counter")
  return {
    then: (onFulfilled, onRejected) => release().then(onFulfilled, onRejected),
    returning: () => reserve(),
  }
}
// oxlint-enable no-thenable

function expensesUpdate(set: Record<string, unknown>): Terminal<ExpenseRow[]> {
  const run = async (): Promise<ExpenseRow[]> => {
    ops.push("update expenses")
    const row = store.expenses.find((e) => e.id === request.expenseId)
    if (!row) return []
    Object.assign(row, set)
    return [{ ...row }]
  }
  return terminal(run, [])
}

function makeClient(ctx: TxContext) {
  const insert = (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      const run = async (): Promise<ExpenseRow[]> => {
        if (table === schema.expenses) {
          ops.push("insert expenses")
          const row: ExpenseRow = {
            id: crypto.randomUUID(),
            tripId: String(values.tripId),
            activityId: (values.activityId as string | null) ?? null,
            description: String(values.description),
            amount: String(values.amount),
            category: (values.category as string) ?? "other",
            paidById: (values.paidById as string | null) ?? null,
            paidAt: (values.paidAt as string | null) ?? null,
            splitMode: (values.splitMode as string) ?? "equal",
            splits: (values.splits as Record<string, string> | null) ?? null,
            createdAt: new Date(),
          }
          store.expenses.push(row)
          return [{ ...row }]
        }
        ops.push("insert activity_log")
        store.log.push(values as unknown as LogRow)
        return []
      }
      return terminal(run, [])
    },
  })

  const update = (table: unknown) => ({
    set: (values: Record<string, unknown>) =>
      table === schema.trips
        ? { where: () => tripsUpdate(ctx, values) }
        : { where: () => expensesUpdate(values) },
  })

  const del = () => ({
    where: async () => {
      ops.push("delete expenses")
      const index = store.expenses.findIndex((e) => e.id === request.expenseId)
      if (index >= 0) store.expenses.splice(index, 1)
    },
  })

  const select = () => ({
    from: () => ({
      where: async () => {
        // The full-table count issue #42 is about. Recorded so a test can
        // assert the insert path stopped doing it.
        ops.push("select count(*) from expenses")
        return [{ count: store.expenses.filter((e) => e.tripId === request.tripId).length }]
      },
    }),
  })

  return { insert, update, delete: del, select }
}

const original = {
  insert: db.insert,
  update: db.update,
  delete: db.delete,
  select: db.select,
  transaction: db.transaction,
  tripsFindFirst: db.query.trips.findFirst,
  membersFindFirst: db.query.tripMembers.findFirst,
  membersFindMany: db.query.tripMembers.findMany,
  expensesFindFirst: db.query.expenses.findFirst,
  expensesFindMany: db.query.expenses.findMany,
  activitiesFindFirst: db.query.activities.findFirst,
}

// drizzle's builder types are not constructible outside drizzle, so each fake
// is cast through `unknown` onto the method it replaces — the same approach
// ai-tools.test.ts uses for `db.query.activities.findMany`.
function installFakeDb(): void {
  const root = makeClient(autocommit)
  db.insert = root.insert as unknown as typeof db.insert
  db.update = root.update as unknown as typeof db.update
  db.delete = root.delete as unknown as typeof db.delete
  db.select = root.select as unknown as typeof db.select

  db.transaction = (async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
    ops.push("begin transaction")
    const ctx: TxContext = { held: [], inTransaction: true }
    const snapshot = structuredClone(store)
    try {
      const result = await callback(makeClient(ctx))
      ops.push("commit")
      return result
    } catch (error) {
      store = snapshot
      ops.push("rollback")
      throw error
    } finally {
      releaseAll(ctx)
    }
  }) as unknown as typeof db.transaction

  db.query.trips.findFirst = (async () => {
    ops.push("query.trips.findFirst")
    return store.trips.find((t) => t.id === request.tripId)
  }) as unknown as typeof db.query.trips.findFirst

  db.query.tripMembers.findMany = (async () => {
    ops.push("query.tripMembers.findMany")
    return store.members
      .filter((m) => m.tripId === request.tripId && m.status === "active")
      .map((m) => structuredClone(m))
  }) as unknown as typeof db.query.tripMembers.findMany

  db.query.tripMembers.findFirst = (async () => {
    ops.push("query.tripMembers.findFirst")
    return store.members.find(
      (m) => m.tripId === request.tripId && m.userId === request.userId && m.status === "active",
    )
  }) as unknown as typeof db.query.tripMembers.findFirst

  // Rows are copied on the way out: a real query returns a snapshot, and the
  // PUT handler relies on that to report before/after amounts.
  db.query.expenses.findFirst = (async () => {
    ops.push("query.expenses.findFirst")
    const row = store.expenses.find(
      (e) => e.id === request.expenseId && e.tripId === request.tripId,
    )
    return row ? { ...row } : undefined
  }) as unknown as typeof db.query.expenses.findFirst

  db.query.expenses.findMany = (async () => {
    ops.push("query.expenses.findMany")
    return store.expenses
      .filter((e) => e.tripId === request.tripId)
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((e) => structuredClone(e))
  }) as unknown as typeof db.query.expenses.findMany

  db.query.activities.findFirst = (async () => {
    ops.push("query.activities.findFirst")
    return store.activities.find((a) => a.id === request.activityId)
  }) as unknown as typeof db.query.activities.findFirst
}

function restoreDb(): void {
  db.insert = original.insert
  db.update = original.update
  db.delete = original.delete
  db.select = original.select
  db.transaction = original.transaction
  db.query.trips.findFirst = original.tripsFindFirst
  db.query.tripMembers.findFirst = original.membersFindFirst
  db.query.tripMembers.findMany = original.membersFindMany
  db.query.expenses.findFirst = original.expensesFindFirst
  db.query.expenses.findMany = original.expensesFindMany
  db.query.activities.findFirst = original.activitiesFindFirst
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
  requireAuth?: unknown
  requireTripAccess?: unknown
  logTripAction?: unknown
  $fetch?: unknown
}

const globals = globalThis as NitroGlobals

globals.defineEventHandler = (handler: unknown) => handler

globals.getValidatedRouterParams = async <T>(event: FakeEvent, validate: Validate<T>) =>
  validated(() => validate(event.context.params))

globals.readValidatedBody = async <T>(event: FakeEvent, validate: Validate<T>) =>
  validated(() => validate(event.context.body))

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

// `defineEventHandler` is the identity stub above, so the default export is the
// raw handler; its declared `EventHandler` type describes the Nitro-wrapped
// form, hence the cast.
const listExpenses = (await import("../api/trips/[id]/expenses/index.get"))
  .default as unknown as Handler<ExpenseRow[]>
const createExpense = (await import("../api/trips/[id]/expenses/index.post"))
  .default as unknown as Handler<ExpenseRow | undefined>
const updateExpense = (await import("../api/trips/[id]/expenses/[expenseId].put"))
  .default as unknown as Handler<ExpenseRow | undefined>
const deleteExpense = (await import("../api/trips/[id]/expenses/[expenseId].delete"))
  .default as unknown as Handler<{ success: boolean }>

interface EventOptions {
  userId?: string | null
  tripId?: string
  expenseId?: string
  activityId?: string
  body?: unknown
}

function makeEvent(options: EventOptions = {}): FakeEvent {
  const tripId = options.tripId ?? TRIP_ID
  const expenseId = options.expenseId ?? EXPENSE_ID
  const userId = options.userId === undefined ? OWNER_ID : options.userId
  request = { tripId, expenseId, userId: userId ?? "", activityId: options.activityId }
  return {
    context: { params: { id: tripId, expenseId }, body: options.body, userId },
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
  return { description: "Ramen", amount: "12.00", category: "food", ...overrides }
}

afterEach(() => {
  releaseAll(autocommit)
})

// ---------------------------------------------------------------------------
// GET /api/trips/:id/expenses
// ---------------------------------------------------------------------------

describe("GET expenses", () => {
  it("returns the trip's expenses newest first", async () => {
    seed({
      expenses: [
        makeExpense({ id: "old", createdAt: new Date("2026-08-01T00:00:00Z") }),
        makeExpense({ id: "new", createdAt: new Date("2026-08-03T00:00:00Z") }),
      ],
    })
    const result = await listExpenses(makeEvent())
    assert.deepEqual(
      result.map((e) => e.id),
      ["new", "old"],
    )
  })

  it("is readable by a viewer — reading expenses is not an editor action", async () => {
    seed({ expenses: [makeExpense()] })
    const result = await listExpenses(makeEvent({ userId: VIEWER_ID }))
    assert.equal(result.length, 1)
  })

  it("rejects an unauthenticated request before touching the database", async () => {
    seed()
    await assertStatus(listExpenses(makeEvent({ userId: null })), 401)
    assert.deepEqual(ops, [])
  })

  it("404s for a user who is not a member, without leaking the trip's existence", async () => {
    seed({ expenses: [makeExpense()] })
    await assertStatus(listExpenses(makeEvent({ userId: STRANGER_ID })), 404)
  })

  it("404s for a trip that does not exist", async () => {
    seed({ trips: [] })
    await assertStatus(listExpenses(makeEvent()), 404)
  })

  it("rejects a non-uuid trip id", async () => {
    seed()
    await assertStatus(listExpenses(makeEvent({ tripId: "not-a-uuid" })), 400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/trips/:id/expenses
// ---------------------------------------------------------------------------

describe("POST expenses", () => {
  it("creates an expense for the owner", async () => {
    seed()
    const created = await createExpense(makeEvent({ body: validBody() }))
    assert.equal(created?.description, "Ramen")
    assert.equal(store.expenses.length, 1)
  })

  it("lets an editor add an expense", async () => {
    seed()
    await createExpense(makeEvent({ userId: EDITOR_ID, body: validBody() }))
    assert.equal(store.expenses.length, 1)
  })

  it("403s for a viewer", async () => {
    seed()
    await assertStatus(createExpense(makeEvent({ userId: VIEWER_ID, body: validBody() })), 403)
    assert.equal(store.expenses.length, 0)
  })

  it("404s for a non-member", async () => {
    seed()
    await assertStatus(createExpense(makeEvent({ userId: STRANGER_ID, body: validBody() })), 404)
    assert.equal(store.expenses.length, 0)
  })

  it("audits the expense in the trip's currency, not a hardcoded $", async () => {
    seed()
    await createExpense(makeEvent({ body: validBody() }))
    const entry = store.log.at(-1)
    assert.equal(entry?.action, "expense_added")
    assert.match(entry?.description ?? "", /12\.00 JPY/)
    assert.equal(entry?.metadata?.currency, "JPY")
  })

  it("stores paidAt as a calendar date, keeping a legacy ISO timestamp's date part", async () => {
    seed()
    await createExpense(makeEvent({ body: validBody({ paidAt: "2026-08-04T23:30:00.000Z" }) }))
    assert.equal(store.expenses[0]?.paidAt, "2026-08-04")
  })

  it("rejects amounts Postgres numeric would choke on", async () => {
    for (const amount of ["-5", "abc", "", "1e40", "12.345"]) {
      seed()
      await assertStatus(createExpense(makeEvent({ body: validBody({ amount }) })), 400)
      assert.equal(store.expenses.length, 0, `expected ${amount} to be rejected`)
    }
  })

  it("rejects an empty description", async () => {
    seed()
    await assertStatus(createExpense(makeEvent({ body: validBody({ description: "" }) })), 400)
  })

  it("rejects an unknown category", async () => {
    seed()
    await assertStatus(createExpense(makeEvent({ body: validBody({ category: "bribes" }) })), 400)
  })

  it("rejects an activity belonging to a different trip", async () => {
    seed({ activities: [{ id: ACTIVITY_ID, day: { tripId: OTHER_TRIP_ID } }] })
    await assertStatus(
      createExpense(
        makeEvent({ activityId: ACTIVITY_ID, body: validBody({ activityId: ACTIVITY_ID }) }),
      ),
      404,
    )
    assert.equal(store.expenses.length, 0)
  })

  it("accepts an activity belonging to this trip", async () => {
    seed({ activities: [{ id: ACTIVITY_ID, day: { tripId: TRIP_ID } }] })
    await createExpense(
      makeEvent({ activityId: ACTIVITY_ID, body: validBody({ activityId: ACTIVITY_ID }) }),
    )
    assert.equal(store.expenses[0]?.activityId, ACTIVITY_ID)
  })

  it("rejects a payer who is not a member of the trip", async () => {
    seed()
    await assertStatus(
      createExpense(makeEvent({ body: validBody({ paidById: STRANGER_ID }) })),
      400,
    )
  })

  it("accepts the owner as payer even though owners have no member row", async () => {
    seed()
    await createExpense(makeEvent({ body: validBody({ paidById: OWNER_ID }) }))
    assert.equal(store.expenses[0]?.paidById, OWNER_ID)
  })
})

// ---------------------------------------------------------------------------
// The 200-expense cap — issue #42
// ---------------------------------------------------------------------------

function seedAtCount(count: number): void {
  seed({
    trips: [
      {
        id: TRIP_ID,
        userId: OWNER_ID,
        currencyCode: "JPY",
        user: { id: OWNER_ID, name: "Olivia Owner" },
        expenseCount: count,
      },
    ],
    expenses: Array.from({ length: count }, (_, i) =>
      makeExpense({ id: crypto.randomUUID(), createdAt: new Date(2026, 0, 1, 0, i) }),
    ),
    members: [
      {
        tripId: TRIP_ID,
        userId: EDITOR_ID,
        role: "editor",
        status: "active",
        user: { id: EDITOR_ID, name: "Eddie Editor" },
      },
      {
        tripId: TRIP_ID,
        userId: VIEWER_ID,
        role: "viewer",
        status: "active",
        user: { id: VIEWER_ID, name: "Vera Viewer" },
      },
    ],
  })
}

describe("expense cap", () => {
  it("rejects the insert that would exceed the cap", async () => {
    seedAtCount(EXPENSE_CAP)
    await assertStatus(createExpense(makeEvent({ body: validBody() })), 400)
    assert.equal(store.expenses.length, EXPENSE_CAP)
  })

  it("still accepts the last insert under the cap", async () => {
    seedAtCount(EXPENSE_CAP - 1)
    await createExpense(makeEvent({ body: validBody() }))
    assert.equal(store.expenses.length, EXPENSE_CAP)
  })

  // #42, part 1: the cap check was `select count(*) from expenses where
  // trip_id = ?` on every single write. Cheap at 200 rows, but it is work that
  // grows with the table for a limit that does not.
  it("does not count the trip's expenses to enforce the cap", async () => {
    seedAtCount(10)
    await createExpense(makeEvent({ body: validBody() }))
    assert.deepEqual(
      ops.filter((op) => op.startsWith("select count")),
      [],
      "the insert path must not scan the expenses table",
    )
  })

  // #42, part 2: read-then-write. Two writers both read 199, both pass the
  // check, and both insert — 201 rows past a cap of 200.
  it("holds the cap when two inserts race", async () => {
    seedAtCount(EXPENSE_CAP - 1)

    const results = await Promise.allSettled([
      createExpense(makeEvent({ body: validBody({ description: "A" }) })),
      createExpense(makeEvent({ body: validBody({ description: "B" }) })),
    ])

    assert.ok(
      store.expenses.length <= EXPENSE_CAP,
      `cap exceeded: ${store.expenses.length} rows for a cap of ${EXPENSE_CAP}`,
    )
    const rejected = results.filter((r) => r.status === "rejected")
    assert.equal(rejected.length, 1, "exactly one of the racing inserts must be refused")
    assert.equal(
      (rejected[0] as PromiseRejectedResult).reason.statusCode,
      400,
      "the loser gets a 400, not a 500",
    )
  })

  it("frees a slot when an expense is deleted, so the cap is not a lifetime quota", async () => {
    seedAtCount(EXPENSE_CAP)
    const doomed = store.expenses[0]
    assert.ok(doomed)
    await deleteExpense(makeEvent({ expenseId: doomed.id }))
    await createExpense(makeEvent({ body: validBody() }))
    assert.equal(store.expenses.length, EXPENSE_CAP)
  })

  it("does not consume a slot when the insert is rejected", async () => {
    seedAtCount(EXPENSE_CAP - 1)
    await assertStatus(createExpense(makeEvent({ body: validBody({ amount: "nope" }) })), 400)
    await createExpense(makeEvent({ body: validBody() }))
    assert.equal(store.expenses.length, EXPENSE_CAP)
    assert.equal(store.trips[0]?.expenseCount, EXPENSE_CAP)
  })
})

// ---------------------------------------------------------------------------
// PUT /api/trips/:id/expenses/:expenseId
// ---------------------------------------------------------------------------

describe("PUT expense", () => {
  it("updates the fields it was given", async () => {
    seed({ expenses: [makeExpense()] })
    const updated = await updateExpense(makeEvent({ body: { description: "Udon" } }))
    assert.equal(updated?.description, "Udon")
    assert.equal(updated?.amount, "12.00")
  })

  it("403s for a viewer", async () => {
    seed({ expenses: [makeExpense()] })
    await assertStatus(
      updateExpense(makeEvent({ userId: VIEWER_ID, body: { description: "Udon" } })),
      403,
    )
  })

  it("404s when the expense belongs to another trip", async () => {
    seed({ expenses: [makeExpense({ tripId: OTHER_TRIP_ID })] })
    await assertStatus(updateExpense(makeEvent({ body: { description: "Udon" } })), 404)
  })

  it("rejects an empty body rather than reporting a no-op as success", async () => {
    seed({ expenses: [makeExpense()] })
    await assertStatus(updateExpense(makeEvent({ body: {} })), 400)
  })

  it("rejects re-pointing the expense at another trip's activity", async () => {
    seed({
      expenses: [makeExpense()],
      activities: [{ id: ACTIVITY_ID, day: { tripId: OTHER_TRIP_ID } }],
    })
    await assertStatus(
      updateExpense(makeEvent({ activityId: ACTIVITY_ID, body: { activityId: ACTIVITY_ID } })),
      404,
    )
  })

  it("rejects re-pointing the payer at a non-member", async () => {
    seed({ expenses: [makeExpense()] })
    await assertStatus(updateExpense(makeEvent({ body: { paidById: STRANGER_ID } })), 400)
  })

  it("records the before and after amounts in the audit log", async () => {
    seed({ expenses: [makeExpense()] })
    await updateExpense(makeEvent({ body: { amount: "30.00" } }))
    const entry = store.log.at(-1)
    assert.equal(entry?.action, "expense_updated")
    assert.deepEqual(entry?.metadata?.before, { amount: "12.00", category: "food" })
    assert.deepEqual(entry?.metadata?.after, { amount: "30.00", category: "food" })
  })

  it("clears paidAt when sent null, and leaves it alone when absent", async () => {
    seed({ expenses: [makeExpense()] })
    await updateExpense(makeEvent({ body: { description: "Udon" } }))
    assert.equal(store.expenses[0]?.paidAt, "2026-08-04")
    await updateExpense(makeEvent({ body: { paidAt: null } }))
    assert.equal(store.expenses[0]?.paidAt, null)
  })
})

// ---------------------------------------------------------------------------
// The money model — issues #35 (splits) and #39 (activity link)
// ---------------------------------------------------------------------------

describe("expense splits", () => {
  // The tracker used to hardcode an equal split across every active member, so
  // a taxi two of five people took was charged to all five. A NULL `splits`
  // still means "everyone", but now that is a choice rather than the only path.
  it("stores no split when the expense is shared by everyone", async () => {
    seed()
    await createExpense(makeEvent({ body: validBody() }))
    assert.equal(store.expenses[0]?.splits, null)
    assert.equal(store.expenses[0]?.splitMode, "equal")
  })

  it("stores resolved amounts once the participant set is narrowed", async () => {
    seed()
    await createExpense(
      makeEvent({
        body: validBody({ amount: "90", participantIds: [OWNER_ID, EDITOR_ID] }),
      }),
    )
    // JPY has no minor unit, so the halves are whole yen.
    assert.deepEqual(store.expenses[0]?.splits, { [OWNER_ID]: "45", [EDITOR_ID]: "45" })
  })

  it("resolves a shares split into amounts that sum to the expense", async () => {
    seed()
    await createExpense(
      makeEvent({
        body: validBody({
          amount: "100",
          splitMode: "shares",
          participantIds: [OWNER_ID, EDITOR_ID, VIEWER_ID],
          splitValues: { [OWNER_ID]: 1, [EDITOR_ID]: 1, [VIEWER_ID]: 1 },
        }),
      }),
    )
    const splits = store.expenses[0]?.splits ?? {}
    assert.equal(
      Object.values(splits).reduce((sum, v) => sum + Number(v), 0),
      100,
    )
  })

  it("rejects a participant who is not on the trip", async () => {
    seed()
    await assertStatus(
      createExpense(makeEvent({ body: validBody({ participantIds: [OWNER_ID, STRANGER_ID] }) })),
      400,
    )
    assert.equal(store.expenses.length, 0)
  })

  it("rejects exact splits that do not add up to the expense", async () => {
    seed()
    await assertStatus(
      createExpense(
        makeEvent({
          body: validBody({
            amount: "100",
            splitMode: "exact",
            participantIds: [OWNER_ID, EDITOR_ID],
            splitValues: { [OWNER_ID]: 60, [EDITOR_ID]: 30 },
          }),
        }),
      ),
      400,
    )
  })

  // A stored split is a set of resolved amounts against a particular total.
  // Leaving it untouched when the amount changes would leave the expense not
  // adding up, so PUT re-resolves it, preserving the proportions.
  it("re-resolves a stored split when the amount changes", async () => {
    seed({
      expenses: [
        makeExpense({
          amount: "100",
          splitMode: "exact",
          splits: { [OWNER_ID]: "75", [EDITOR_ID]: "25" },
        }),
      ],
    })
    await updateExpense(makeEvent({ body: { amount: "200" } }))
    assert.deepEqual(store.expenses[0]?.splits, { [OWNER_ID]: "150", [EDITOR_ID]: "50" })
  })

  it("clears the split when the participants are cleared", async () => {
    seed({
      expenses: [makeExpense({ splits: { [OWNER_ID]: "6", [EDITOR_ID]: "6" } })],
    })
    await updateExpense(makeEvent({ body: { splitMode: "equal", participantIds: [] } }))
    assert.equal(store.expenses[0]?.splits, null)
  })
})

describe("activity link", () => {
  // `expenses.activityId` had a column, an index and a relation, and no code
  // path ever set it, so estimated and actual cost never met.
  it("stores the activity an expense belongs to", async () => {
    seed({ activities: [{ id: ACTIVITY_ID, day: { tripId: TRIP_ID } }] })
    await createExpense(
      makeEvent({ activityId: ACTIVITY_ID, body: validBody({ activityId: ACTIVITY_ID }) }),
    )
    assert.equal(store.expenses[0]?.activityId, ACTIVITY_ID)
  })

  it("clears the link when sent null", async () => {
    seed({ expenses: [makeExpense({ activityId: ACTIVITY_ID })] })
    await updateExpense(makeEvent({ body: { activityId: null } }))
    assert.equal(store.expenses[0]?.activityId, null)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/trips/:id/expenses/:expenseId
// ---------------------------------------------------------------------------

describe("DELETE expense", () => {
  it("deletes the expense", async () => {
    seed({ expenses: [makeExpense()] })
    const result = await deleteExpense(makeEvent())
    assert.deepEqual(result, { success: true })
    assert.equal(store.expenses.length, 0)
  })

  it("403s for a viewer", async () => {
    seed({ expenses: [makeExpense()] })
    await assertStatus(deleteExpense(makeEvent({ userId: VIEWER_ID })), 403)
    assert.equal(store.expenses.length, 1)
  })

  it("404s when the expense belongs to another trip", async () => {
    seed({ expenses: [makeExpense({ tripId: OTHER_TRIP_ID })] })
    await assertStatus(deleteExpense(makeEvent()), 404)
  })

  // A collaborator deleting someone else's row moves real money in the
  // settlement, so it has to leave a trace.
  it("audits the deletion", async () => {
    seed({ expenses: [makeExpense()] })
    await deleteExpense(makeEvent({ userId: EDITOR_ID }))
    const entry = store.log.at(-1)
    assert.equal(entry?.action, "expense_deleted")
    assert.equal(entry?.userId, EDITOR_ID)
    assert.equal(entry?.metadata?.amount, "12.00")
  })
})

// bun test shares one process across files; leave the singleton as found.
process.on("exit", restoreDb)
