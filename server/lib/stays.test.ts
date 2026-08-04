import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { itineraryDays } from "../db/schema"

const { addCalendarDays, stayKey, groupDaysIntoStayRuns, syncDayAccommodation } =
  await import("./stays")
type DayAccommodation = import("./stays").DayAccommodation
type Tx = import("./stays").Tx

/** Minimal day row — only the columns the stay grouping reads. */
function day(
  id: string,
  date: string,
  name: string | null,
  placeId: string | null = null,
): DayAccommodation {
  return {
    id,
    date,
    accommodationName: name,
    accommodationPlaceId: placeId,
    accommodationAddress: name ? `${name} Street 1` : null,
    accommodationLat: name ? 35.1 : null,
    accommodationLng: name ? 139.1 : null,
  }
}

interface RecordedUpdate {
  table: unknown
  set: Record<string, unknown>
}

function makeFakeTx() {
  const updates: RecordedUpdate[] = []
  const fake = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ table, set: values })
        },
      }),
    }),
  }
  // Structural fake for the drizzle transaction handle — accepted case for the cast.
  return { tx: fake as unknown as Tx, updates }
}

describe("addCalendarDays", () => {
  it("adds days without drifting across timezones", () => {
    assert.equal(addCalendarDays("2026-03-22", 1), "2026-03-23")
    assert.equal(addCalendarDays("2026-03-31", 1), "2026-04-01")
    assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01")
    assert.equal(addCalendarDays("2026-02-28", 1), "2026-03-01")
    assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29")
    assert.equal(addCalendarDays("2026-03-22", 0), "2026-03-22")
  })
})

describe("stayKey", () => {
  it("prefers the Google place id", () => {
    assert.equal(stayKey(day("d1", "2026-03-22", "Hotel Nikko", "place-abc")), "place-abc")
  })

  it("falls back to the lowercased name so casing edits don't split a run", () => {
    assert.equal(stayKey(day("d1", "2026-03-22", "Hotel Nikko")), "hotel nikko")
    assert.equal(stayKey(day("d2", "2026-03-23", "HOTEL NIKKO")), "hotel nikko")
  })

  it("returns null for a day with no accommodation", () => {
    assert.equal(stayKey(day("d1", "2026-03-22", null)), null)
  })
})

describe("groupDaysIntoStayRuns", () => {
  it("collapses a contiguous run into one stay with an exclusive check-out", () => {
    const runs = groupDaysIntoStayRuns([
      day("d1", "2026-03-22", "Hotel Nikko", "place-abc"),
      day("d2", "2026-03-23", "Hotel Nikko", "place-abc"),
      day("d3", "2026-03-24", "Hotel Nikko", "place-abc"),
    ])

    assert.equal(runs.length, 1)
    assert.equal(runs[0]!.name, "Hotel Nikko")
    assert.equal(runs[0]!.placeId, "place-abc")
    assert.equal(runs[0]!.checkIn, "2026-03-22")
    // Three nights from the 22nd means checking out on the 25th.
    assert.equal(runs[0]!.checkOut, "2026-03-25")
    assert.deepEqual(runs[0]!.dayIds, ["d1", "d2", "d3"])
  })

  it("starts a new stay when the hotel changes", () => {
    const runs = groupDaysIntoStayRuns([
      day("d1", "2026-03-22", "Hotel Nikko", "place-abc"),
      day("d2", "2026-03-23", "Ryokan Asaba", "place-xyz"),
    ])

    assert.equal(runs.length, 2)
    assert.deepEqual(
      runs.map((r) => r.name),
      ["Hotel Nikko", "Ryokan Asaba"],
    )
    assert.equal(runs[0]!.checkOut, "2026-03-23")
    assert.equal(runs[1]!.checkIn, "2026-03-23")
  })

  it("splits a run broken by a day with no accommodation", () => {
    const runs = groupDaysIntoStayRuns([
      day("d1", "2026-03-22", "Hotel Nikko", "place-abc"),
      day("d2", "2026-03-23", null),
      day("d3", "2026-03-24", "Hotel Nikko", "place-abc"),
    ])

    // A hotel revisited after a gap is two stays, not one long one.
    assert.equal(runs.length, 2)
    assert.deepEqual(
      runs.map((r) => [r.checkIn, r.checkOut]),
      [
        ["2026-03-22", "2026-03-23"],
        ["2026-03-24", "2026-03-25"],
      ],
    )
  })

  it("splits when the dates are non-contiguous even with no intervening row", () => {
    const runs = groupDaysIntoStayRuns([
      day("d1", "2026-03-22", "Hotel Nikko", "place-abc"),
      day("d3", "2026-03-25", "Hotel Nikko", "place-abc"),
    ])

    assert.equal(runs.length, 2)
  })

  it("sorts by date before grouping", () => {
    const runs = groupDaysIntoStayRuns([
      day("d3", "2026-03-24", "Hotel Nikko", "place-abc"),
      day("d1", "2026-03-22", "Hotel Nikko", "place-abc"),
      day("d2", "2026-03-23", "Hotel Nikko", "place-abc"),
    ])

    assert.equal(runs.length, 1)
    assert.deepEqual(runs[0]!.dayIds, ["d1", "d2", "d3"])
  })

  it("ignores days with no accommodation entirely", () => {
    assert.deepEqual(
      groupDaysIntoStayRuns([day("d1", "2026-03-22", null), day("d2", "2026-03-23", null)]),
      [],
    )
  })

  it("carries the Google-verified location fields onto the stay", () => {
    const runs = groupDaysIntoStayRuns([day("d1", "2026-03-22", "Hotel Nikko", "place-abc")])

    assert.equal(runs[0]!.address, "Hotel Nikko Street 1")
    assert.equal(runs[0]!.lat, 35.1)
    assert.equal(runs[0]!.lng, 139.1)
  })
})

describe("syncDayAccommodation", () => {
  // `accommodation_*` on itinerary_days is a derived read-cache with exactly
  // one writer. Any other write to those columns is a drift bug.
  it("mirrors every accommodation column onto the days linked to the stay", async () => {
    const { tx, updates } = makeFakeTx()
    await syncDayAccommodation(tx, {
      id: "stay-1",
      name: "Hotel Nikko",
      placeId: "place-abc",
      address: "Hotel Nikko Street 1",
      lat: 35.1,
      lng: 139.1,
    })

    assert.equal(updates.length, 1)
    assert.equal(updates[0]!.table, itineraryDays)
    assert.deepEqual(updates[0]!.set, {
      accommodationName: "Hotel Nikko",
      accommodationPlaceId: "place-abc",
      accommodationAddress: "Hotel Nikko Street 1",
      accommodationLat: 35.1,
      accommodationLng: 139.1,
    })
  })
})
