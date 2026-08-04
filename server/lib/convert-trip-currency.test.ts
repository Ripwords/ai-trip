import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { trips, activities, expenses, reservations } from "../db/schema"

const { convertTripMoney } = await import("./convert-trip-currency")
type Tx = import("./convert-trip-currency").Tx

interface RecordedUpdate {
  table: unknown
  set: Record<string, unknown>
}

function makeFakeTx(dayRows: { id: string }[]) {
  const updates: RecordedUpdate[] = []
  const fake = {
    select: () => ({ from: () => ({ where: async () => dayRows }) }),
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

/** Pull the interpolated numbers out of a drizzle `sql` fragment, in order. */
function sqlNumbers(value: unknown): number[] {
  const chunks = (value as { queryChunks?: unknown[] })?.queryChunks
  if (!Array.isArray(chunks)) return []
  return chunks.filter((c): c is number => typeof c === "number")
}

describe("convertTripMoney", () => {
  it("converts reservations.amount alongside activities, expenses, and budget", async () => {
    const { tx, updates } = makeFakeTx([{ id: "day-1" }])
    await convertTripMoney(tx, "trip-1", 0.9, "EUR")

    const tables = updates.map((u) => u.table)
    assert.ok(tables.includes(reservations), "reservations must be converted")
    assert.ok(tables.includes(expenses), "expenses must be converted")
    assert.ok(tables.includes(trips), "trips must be updated")
    assert.equal(tables.filter((t) => t === activities).length, 2, "costEstimate and actualCost")

    const reservationUpdate = updates.find((u) => u.table === reservations)!
    assert.ok("amount" in reservationUpdate.set)
  })

  it("sets the new currency code on the trip", async () => {
    const { tx, updates } = makeFakeTx([])
    await convertTripMoney(tx, "trip-1", 0.9, "EUR")

    const tripUpdate = updates.find((u) => u.table === trips)!
    assert.equal(tripUpdate.set.currencyCode, "EUR")
  })

  it("skips activity updates when the trip has no itinerary days", async () => {
    const { tx, updates } = makeFakeTx([])
    await convertTripMoney(tx, "trip-1", 0.9, "EUR")

    assert.ok(!updates.some((u) => u.table === activities))
    assert.ok(updates.some((u) => u.table === reservations))
  })

  // Every column used to be ROUND(..., 2), which produced impossible values
  // like "1234.56 JPY" — currencies with no minor unit must land on whole
  // numbers. shared/utils/currency.ts already knew this; conversion didn't use it.
  it("rounds to whole units when converting to a zero-decimal currency", async () => {
    const { tx, updates } = makeFakeTx([{ id: "day-1" }])
    await convertTripMoney(tx, "trip-1", 155.2, "JPY")

    for (const update of updates) {
      for (const [column, value] of Object.entries(update.set)) {
        if (column === "currencyCode") continue
        assert.deepEqual(
          sqlNumbers(value).filter((n) => n !== 155.2),
          [0],
          `${column} must round to 0 decimals for JPY`,
        )
      }
    }
  })

  it("still rounds to 2 decimals for a normal currency", async () => {
    const { tx, updates } = makeFakeTx([{ id: "day-1" }])
    await convertTripMoney(tx, "trip-1", 0.9, "EUR")

    const expenseUpdate = updates.find((u) => u.table === expenses)!
    assert.deepEqual(
      sqlNumbers(expenseUpdate.set.amount).filter((n) => n !== 0.9),
      [2],
    )
  })
})
