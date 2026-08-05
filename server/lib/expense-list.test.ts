/**
 * The SQL behind `GET /api/trips/:id/expenses` — issue #49.
 *
 * These assertions compile the drizzle conditions to real Postgres text and
 * check the *text and the bound values*, not that some key is present. A recent
 * audit of this repo found tests that passed while the query was wrong, because
 * the fake database ignored `where` entirely; compiling the condition removes
 * the fake from the equation for the part that matters most.
 */

process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { describe, it } from "bun:test"
import { and, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"

const { buildExpenseCursorCondition, buildExpenseFilterConditions, expenseListOrderBy } =
  await import("./expense-list")

const dialect = new PgDialect()
const TRIP_ID = "11111111-1111-4111-8111-111111111111"

function compile(condition: SQL | undefined): { sql: string; params: unknown[] } {
  assert.ok(condition, "expected a condition")
  const query = dialect.sqlToQuery(condition)
  return { sql: query.sql, params: query.params }
}

function compileAll(conditions: SQL[]): { sql: string; params: unknown[] } {
  return compile(and(...conditions))
}

describe("expense list filters", () => {
  it("always scopes to the trip", () => {
    const { sql, params } = compileAll(buildExpenseFilterConditions(TRIP_ID, {}))
    assert.equal(sql, `"expenses"."trip_id" = $1`)
    assert.deepEqual(params, [TRIP_ID])
  })

  it("filters by category with the category actually bound", () => {
    const { sql, params } = compileAll(buildExpenseFilterConditions(TRIP_ID, { category: "food" }))
    assert.equal(sql, `("expenses"."trip_id" = $1 and "expenses"."category" = $2)`)
    assert.deepEqual(params, [TRIP_ID, "food"])
  })

  it("filters by payer", () => {
    const { sql, params } = compileAll(
      buildExpenseFilterConditions(TRIP_ID, { payerId: "user-editor" }),
    )
    assert.equal(sql, `("expenses"."trip_id" = $1 and "expenses"."paid_by_id" = $2)`)
    assert.deepEqual(params, [TRIP_ID, "user-editor"])
  })

  it("treats payerId=none as 'nobody recorded', not as a user called none", () => {
    const { sql, params } = compileAll(buildExpenseFilterConditions(TRIP_ID, { payerId: "none" }))
    assert.equal(sql, `("expenses"."trip_id" = $1 and "expenses"."paid_by_id" is null)`)
    assert.deepEqual(params, [TRIP_ID])
  })

  it("bounds the date range inclusively on both ends", () => {
    const { sql, params } = compileAll(
      buildExpenseFilterConditions(TRIP_ID, { from: "2026-08-01", to: "2026-08-31" }),
    )
    assert.equal(
      sql,
      `("expenses"."trip_id" = $1 and "expenses"."paid_at" >= $2 and "expenses"."paid_at" <= $3)`,
    )
    assert.deepEqual(params, [TRIP_ID, "2026-08-01", "2026-08-31"])
  })

  it("does not emit a clause for a filter that was not supplied", () => {
    const { sql } = compileAll(buildExpenseFilterConditions(TRIP_ID, { from: "2026-08-01" }))
    assert.ok(!sql.includes("category"))
    assert.ok(!sql.includes("paid_by_id"))
    assert.ok(!sql.includes("<="))
  })
})

describe("expense list ordering", () => {
  it("orders by paid_at with undated rows last, tie-broken by id", () => {
    const compiled = expenseListOrderBy("paidAt", "desc").map((s) => dialect.sqlToQuery(s).sql)
    assert.deepEqual(compiled, [`"expenses"."paid_at" desc nulls last`, `"expenses"."id" desc`])
  })

  it("keeps undated rows last when ascending too, so the tie-break stays stable", () => {
    const compiled = expenseListOrderBy("paidAt", "asc").map((s) => dialect.sqlToQuery(s).sql)
    assert.deepEqual(compiled, [`"expenses"."paid_at" asc nulls last`, `"expenses"."id" asc`])
  })

  it("orders by amount numerically", () => {
    const compiled = expenseListOrderBy("amount", "desc").map((s) => dialect.sqlToQuery(s).sql)
    assert.deepEqual(compiled, [`"expenses"."amount" desc`, `"expenses"."id" desc`])
  })

  it("orders by createdAt", () => {
    const compiled = expenseListOrderBy("createdAt", "desc").map((s) => dialect.sqlToQuery(s).sql)
    assert.deepEqual(compiled, [`"expenses"."created_at" desc`, `"expenses"."id" desc`])
  })
})

describe("expense list cursor condition", () => {
  it("walks descending past a dated row, and past every undated row after it", () => {
    const { sql, params } = compile(
      buildExpenseCursorCondition({ field: "paidAt", value: "2026-08-04", id: "row-9" }, "desc"),
    )
    assert.equal(
      sql,
      `("expenses"."paid_at" < $1 or ("expenses"."paid_at" = $2 and "expenses"."id" < $3) or "expenses"."paid_at" is null)`,
    )
    assert.deepEqual(params, ["2026-08-04", "2026-08-04", "row-9"])
  })

  it("stays inside the undated tail once the cursor is on an undated row", () => {
    const { sql, params } = compile(
      buildExpenseCursorCondition({ field: "paidAt", value: null, id: "row-9" }, "desc"),
    )
    assert.equal(sql, `("expenses"."paid_at" is null and "expenses"."id" < $1)`)
    assert.deepEqual(params, ["row-9"])
  })

  it("flips the comparison when ascending", () => {
    const { sql, params } = compile(
      buildExpenseCursorCondition({ field: "paidAt", value: "2026-08-04", id: "row-9" }, "asc"),
    )
    assert.equal(
      sql,
      `("expenses"."paid_at" > $1 or ("expenses"."paid_at" = $2 and "expenses"."id" > $3) or "expenses"."paid_at" is null)`,
    )
    assert.deepEqual(params, ["2026-08-04", "2026-08-04", "row-9"])
  })

  it("needs no null branch for a non-nullable sort column", () => {
    const { sql, params } = compile(
      buildExpenseCursorCondition({ field: "amount", value: "12.00", id: "row-9" }, "desc"),
    )
    assert.equal(
      sql,
      `("expenses"."amount" < $1 or ("expenses"."amount" = $2 and "expenses"."id" < $3))`,
    )
    assert.deepEqual(params, ["12.00", "12.00", "row-9"])
  })

  // A cursor value is a string on the wire. Bound as text it would compare
  // lexicographically against a timestamptz; it has to go through the column's
  // encoder. The input below is deliberately not already in the encoder's
  // output form, so a raw pass-through cannot pass this test.
  it("binds createdAt through the timestamp encoder, not as the raw cursor string", () => {
    const { params } = compile(
      buildExpenseCursorCondition(
        { field: "createdAt", value: "2026-08-04T10:00:00Z", id: "row-9" },
        "desc",
      ),
    )
    assert.deepEqual(params, ["2026-08-04T10:00:00.000Z", "2026-08-04T10:00:00.000Z", "row-9"])
  })
})
