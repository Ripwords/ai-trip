import assert from "node:assert/strict"
import { describe, it } from "bun:test"

import type { FlightLookupResult } from "./flight-api"
import { flightRefreshDue, refreshDueFlights, type RefreshableFlight } from "./flight-refresh"

const HOUR = 60 * 60 * 1000
const MIN = 60 * 1000

// SQ322 SIN → LHR, departs 15:35Z, lands 05:10Z next day.
const DEP = new Date("2026-10-12T15:35:00Z")
const ARR = new Date("2026-10-13T05:10:00Z")

function leg(overrides: Partial<RefreshableFlight> = {}): RefreshableFlight {
  return {
    id: "f1",
    flightNumber: "SQ322",
    flightDate: "2026-10-12",
    status: "scheduled",
    scheduledDepartureTime: DEP,
    actualDepartureTime: null,
    scheduledArrivalTime: ARR,
    actualArrivalTime: null,
    apiLastFetchedAt: new Date(DEP.getTime() - 10 * 24 * HOUR),
    ...overrides,
  }
}

const at = (base: Date, offsetMs: number) => new Date(base.getTime() + offsetMs)

describe("flightRefreshDue", () => {
  it("leaves a flight more than 48h out alone, however old its data", () => {
    assert.equal(flightRefreshDue(leg(), at(DEP, -49 * HOUR)), false)
  })

  it("refreshes a flight departing within 48h whose data is over 2h old", () => {
    const now = at(DEP, -30 * HOUR)
    assert.equal(flightRefreshDue(leg(), now), true)
    assert.equal(flightRefreshDue(leg({ apiLastFetchedAt: at(now, -90 * MIN) }), now), false)
  })

  it("refreshes every 15 minutes from 6h before departure until it lands", () => {
    for (const now of [at(DEP, -5 * HOUR), at(DEP, 3 * HOUR), at(ARR, 10 * MIN)]) {
      assert.equal(flightRefreshDue(leg({ apiLastFetchedAt: at(now, -20 * MIN) }), now), true)
      assert.equal(flightRefreshDue(leg({ apiLastFetchedAt: at(now, -10 * MIN) }), now), false)
    }
  })

  it("fetches a landed flight once more after it lands, then treats it as final", () => {
    const now = at(ARR, 5 * HOUR)
    // Last read while still in the air: the actual times are missing.
    assert.equal(flightRefreshDue(leg({ apiLastFetchedAt: at(ARR, -1 * HOUR) }), now), true)
    // Read after landing: final.
    assert.equal(flightRefreshDue(leg({ apiLastFetchedAt: at(ARR, 1 * HOUR) }), now), false)
  })

  it("follows a delayed arrival rather than the scheduled one", () => {
    const late = at(ARR, 3 * HOUR)
    const now = at(ARR, 2 * HOUR)
    // Fetched after the scheduled arrival, but the leg is still in the air.
    const row = leg({ actualArrivalTime: late, apiLastFetchedAt: at(now, -20 * MIN) })
    assert.equal(flightRefreshDue(row, now), true)
  })

  it("stops once the flight is more than 48h past its arrival", () => {
    assert.equal(flightRefreshDue(leg(), at(ARR, 49 * HOUR)), false)
  })

  it("refreshes a never-fetched flight inside the window", () => {
    assert.equal(flightRefreshDue(leg({ apiLastFetchedAt: null }), at(DEP, -1 * HOUR)), true)
  })

  it("does not keep polling a cancelled flight", () => {
    const now = at(DEP, -1 * HOUR)
    const row = leg({ status: "cancelled", apiLastFetchedAt: at(now, -3 * HOUR) })
    assert.equal(flightRefreshDue(row, now), false)
  })

  it("falls back to the flight date when the row has no times", () => {
    const row = leg({
      scheduledDepartureTime: null,
      scheduledArrivalTime: null,
      apiLastFetchedAt: null,
    })
    assert.equal(flightRefreshDue(row, new Date("2026-10-11T12:00:00Z")), true)
    assert.equal(flightRefreshDue(row, new Date("2026-10-01T00:00:00Z")), false)
  })
})

function result(overrides: Partial<FlightLookupResult> = {}): FlightLookupResult {
  return {
    airline: "Singapore Airlines",
    departureAirport: "SIN",
    arrivalAirport: "LHR",
    scheduledDepartureTime: DEP,
    actualDepartureTime: at(DEP, 20 * MIN),
    scheduledArrivalTime: ARR,
    actualArrivalTime: null,
    terminal: "3",
    gate: "B4",
    status: "departed",
    rawApiResponse: {},
    ...overrides,
  }
}

describe("refreshDueFlights", () => {
  it("looks up only the due flights and returns the saved rows in place", async () => {
    const now = at(DEP, 1 * HOUR)
    const due = leg({ id: "due" })
    const distant = leg({
      id: "distant",
      flightDate: "2026-12-01",
      scheduledDepartureTime: new Date("2026-12-01T10:00:00Z"),
      scheduledArrivalTime: new Date("2026-12-01T14:00:00Z"),
    })
    const looked: string[] = []

    const rows = await refreshDueFlights([distant, due], {
      now,
      lookup: async (flightNumber) => {
        looked.push(flightNumber)
        return result()
      },
      save: async (row, fresh, fetchedAt) => ({
        ...row,
        status: fresh.status,
        apiLastFetchedAt: fetchedAt,
      }),
    })

    assert.deepEqual(looked, ["SQ322"])
    assert.equal(rows[0]!.id, "distant")
    assert.equal(rows[1]!.status, "departed")
    assert.equal(rows[1]!.apiLastFetchedAt?.getTime(), now.getTime())
  })

  it("caps the lookups per request, nearest departures first", async () => {
    const now = at(DEP, -1 * HOUR)
    const rows = [5, 1, 3, 2, 4].map((h) =>
      leg({ id: `+${h}h`, scheduledDepartureTime: at(now, h * HOUR), apiLastFetchedAt: null }),
    )
    const saved: string[] = []

    await refreshDueFlights(rows, {
      now,
      limit: 3,
      lookup: async () => result(),
      save: async (row) => {
        saved.push(row.id)
        return row
      },
    })

    assert.deepEqual(saved.toSorted(), ["+1h", "+2h", "+3h"])
  })

  it("keeps the stored row when the lookup returns nothing or throws", async () => {
    const now = at(DEP, 1 * HOUR)
    const a = leg({ id: "a" })
    const b = leg({ id: "b", flightNumber: "SQ999" })

    const rows = await refreshDueFlights([a, b], {
      now,
      lookup: async (flightNumber) => {
        if (flightNumber === "SQ999") throw new Error("boom")
        return null
      },
      save: async () => {
        throw new Error("save must not run without a result")
      },
    })

    assert.deepEqual(rows, [a, b])
  })
})
