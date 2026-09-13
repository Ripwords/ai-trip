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

  it("returns legs in departure order even when flightDate labels disagree", async () => {
    const leg = (flightNumber: string, flightDate: string, departureTime: string) => ({
      id: flightNumber,
      userId: "user-1",
      tripId: "trip-1",
      flightNumber,
      flightDate,
      airline: null,
      departureAirport: null,
      arrivalAirport: null,
      departureTime: new Date(departureTime),
      arrivalTime: null,
      terminal: null,
      gate: null,
      status: "landed",
      rawApiResponse: null,
      apiLastFetchedAt: new Date(),
      lookupSchemaVersion: Number.MAX_SAFE_INTEGER,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // EK3391 boards LHR at 05:24 the morning after the red-eye that fed it, so
    // its flightDate label is a day behind its actual departure.
    const { db } = makeFakeDb([
      leg("EK3322", "2025-09-23", "2025-09-23T18:25:00Z"),
      leg("EK3391", "2025-09-13", "2025-09-14T05:24:00Z"),
      leg("EK3", "2025-09-13", "2025-09-13T22:27:00Z"),
    ])

    const result = await getTripFlightsForUser({ tripId: "trip-1", userId: "user-1" }, db)

    assert.deepEqual(
      result.map((r) => (r as Record<string, unknown>).flightNumber),
      ["EK3", "EK3391", "EK3322"],
    )
  })
})
