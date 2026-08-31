import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { PgDialect } from "drizzle-orm/pg-core"

import { loadTripVisibility } from "./trip-visibility"

type Deps = Parameters<typeof loadTripVisibility>[1]
type DbHandle = NonNullable<NonNullable<Deps>["db"]>

const USER_ID = "user-owner"

/** The `args` the code under test passed to `db.query.tripMembers.findMany`. */
interface Recorded {
  where?: unknown
  columns?: Record<string, boolean>
}

function fakeDb(tripIds: string[], recorded: Recorded = {}) {
  return {
    query: {
      tripMembers: {
        findMany: async (args: Recorded) => {
          Object.assign(recorded, args)
          return tripIds.map((tripId) => ({ tripId }))
        },
      },
    },
  } as unknown as DbHandle
}

const dialect = new PgDialect()

/** The condition as Postgres would receive it: text plus bound parameters. */
function compile(condition: Parameters<typeof dialect.sqlToQuery>[0]) {
  const { sql, params } = dialect.sqlToQuery(condition)
  return { sql, params }
}

describe("loadTripVisibility", () => {
  it("selects only owned trips when the user has no memberships", async () => {
    const visibility = await loadTripVisibility(USER_ID, { db: fakeDb([]) })

    assert.deepEqual(visibility.memberTripIds, [])
    const { sql, params } = compile(visibility.condition)
    assert.equal(sql, `"trips"."user_id" = $1`)
    assert.deepEqual(params, [USER_ID])
  })

  it("adds the member trips when the user has memberships", async () => {
    const visibility = await loadTripVisibility(USER_ID, { db: fakeDb(["trip-a", "trip-b"]) })

    assert.deepEqual(visibility.memberTripIds, ["trip-a", "trip-b"])
    const { sql, params } = compile(visibility.condition)
    assert.equal(sql, `("trips"."user_id" = $1 or "trips"."id" in ($2, $3))`)
    assert.deepEqual(params, [USER_ID, "trip-a", "trip-b"])
  })

  // A pending invite shows on the dashboard but requireTripAccess rejects it as
  // "Trip not found", so the two must agree on which memberships count.
  it("asks the database only for this user's active memberships", async () => {
    const recorded: Recorded = {}
    await loadTripVisibility(USER_ID, { db: fakeDb([], recorded) })

    const { sql, params } = compile(recorded.where as Parameters<typeof compile>[0])
    assert.equal(sql, `("trip_members"."user_id" = $1 and "trip_members"."status" = $2)`)
    assert.deepEqual(params, [USER_ID, "active"])
    assert.deepEqual(recorded.columns, { tripId: true })
  })
})
