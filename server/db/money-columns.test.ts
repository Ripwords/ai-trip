/**
 * Every money column has to be wide enough for whatever `moneyString` accepts
 * (14 integer digits + 2 decimals, i.e. `numeric(16, 2)`).
 *
 * `expenses.amount` was widened for #47, but activity costs, reservation
 * amounts and the trip budget stayed `numeric(10, 2)` — so a 150,000,000 VND
 * hotel passed validation and then 500'd with `22003 numeric field overflow`,
 * and so did converting a USD 5,000 budget into VND (audit B1).
 */
import assert from "node:assert/strict"
import { describe, it } from "bun:test"
import { getTableColumns, getTableName, is, type Table } from "drizzle-orm"
import { PgNumeric, PgTable } from "drizzle-orm/pg-core"
import * as schema from "./schema"
import { moneyString } from "../utils/schemas"

const MONEY_COLUMNS: readonly (readonly [Table, string])[] = [
  [schema.activities, "costEstimate"],
  [schema.activities, "actualCost"],
  [schema.reservations, "amount"],
  [schema.trips, "budget"],
  [schema.expenses, "amount"],
  [schema.expenses, "amountInTripCurrency"],
]

describe("money columns", () => {
  it("the largest amount the validator accepts is a valid money string", () => {
    assert.equal(moneyString.safeParse("99999999999999.99").success, true)
  })

  for (const [table, key] of MONEY_COLUMNS) {
    it(`${getTableName(table)}.${key} is numeric(16, 2), matching moneyString`, () => {
      const column = getTableColumns(table)[key]
      assert.ok(column instanceof PgNumeric, `${key} should be a numeric column`)
      assert.equal(column.precision, 16)
      assert.equal(column.scale, 2)
    })
  }

  it("no other scale-2 numeric column is narrower than the validator", () => {
    for (const table of Object.values(schema)) {
      if (!is(table, PgTable)) continue
      for (const [key, column] of Object.entries(getTableColumns(table))) {
        if (!(column instanceof PgNumeric) || column.scale !== 2) continue
        assert.ok(
          (column.precision ?? 0) >= 16,
          `${getTableName(table)}.${key} is numeric(${column.precision}, 2)`,
        )
      }
    }
  })
})
