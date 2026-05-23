import assert from "node:assert/strict"
import { describe, it } from "bun:test"

import { getTripFlightsForUser } from "./trip-flights"

function columnsReferenced(expr: unknown): string[] {
  const out: string[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const obj = node as Record<string, unknown>
    if (typeof obj.name === "string" && obj.table) out.push(obj.name)
    const chunks = obj.queryChunks as unknown[] | undefined
    if (Array.isArray(chunks)) for (const c of chunks) visit(c)
  }
  visit(expr)
  return out
}

type FindManyOpts = { where: unknown; orderBy?: unknown }

function makeFakeDb(rows: Record<string, unknown>[]) {
  const findManyCalls: FindManyOpts[] = []
  const db = {
    query: {
      flights: {
        findMany: async (opts: FindManyOpts) => {
          findManyCalls.push(opts)
          return rows
        },
      },
    },
  } as unknown as Parameters<typeof getTripFlightsForUser>[1]
  return { db, findManyCalls }
}

describe("getTripFlightsForUser", () => {
  it("queries flights filtered by both trip_id and user_id", async () => {
    const { db, findManyCalls } = makeFakeDb([])

    await getTripFlightsForUser({ tripId: "trip-1", userId: "user-1" }, db)

    assert.equal(findManyCalls.length, 1)
    const cols = columnsReferenced(findManyCalls[0]!.where)
    assert.ok(cols.includes("trip_id"), `where should reference trip_id, got [${cols.join(", ")}]`)
    assert.ok(cols.includes("user_id"), `where should reference user_id, got [${cols.join(", ")}]`)
  })

  it("returns rows with rawApiResponse stripped and derived fields added", async () => {
    const { db } = makeFakeDb([
      {
        id: "f1",
        userId: "user-1",
        tripId: "trip-1",
        flightNumber: "AA123",
        flightDate: "2026-06-01",
        airline: null,
        departureAirport: "JFK",
        arrivalAirport: "LAX",
        departureTime: null,
        arrivalTime: null,
        terminal: null,
        gate: null,
        status: "scheduled",
        rawApiResponse: { secret: "should be stripped" },
        apiLastFetchedAt: new Date(),
        // already current → maybeMigrateRow short-circuits
        lookupSchemaVersion: Number.MAX_SAFE_INTEGER,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const result = await getTripFlightsForUser({ tripId: "trip-1", userId: "user-1" }, db)

    assert.equal(result.length, 1)
    const row = result[0] as Record<string, unknown>
    assert.equal(row.flightNumber, "AA123")
    assert.equal(row.departureAirport, "JFK")
    assert.equal("rawApiResponse" in row, false)
  })
})
