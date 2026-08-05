import assert from "node:assert/strict"
import { describe, it } from "bun:test"
import {
  EXPENSE_PAGE_SIZE_DEFAULT,
  EXPENSE_PAGE_SIZE_MAX,
  decodeExpenseCursor,
  encodeExpenseCursor,
} from "./expense-list"

describe("expense cursor", () => {
  it("round-trips a dated cursor", () => {
    const raw = encodeExpenseCursor({ field: "paidAt", value: "2026-08-04", id: "abc" })
    assert.deepEqual(decodeExpenseCursor(raw), {
      field: "paidAt",
      value: "2026-08-04",
      id: "abc",
    })
  })

  it("round-trips an undated cursor — paid_at is nullable", () => {
    const raw = encodeExpenseCursor({ field: "paidAt", value: null, id: "abc" })
    assert.deepEqual(decodeExpenseCursor(raw), { field: "paidAt", value: null, id: "abc" })
  })

  it("produces a url-safe token with no padding", () => {
    const raw = encodeExpenseCursor({
      field: "createdAt",
      value: "2026-08-04T10:00:00.000Z",
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    })
    assert.match(raw, /^[A-Za-z0-9_-]+$/)
  })

  it("rejects garbage rather than throwing", () => {
    for (const bad of ["", "!!!!", "Zm9v", btoa("[]"), btoa('{"field":"nope","id":"x"}')]) {
      assert.equal(decodeExpenseCursor(bad), null, `expected ${bad} to be rejected`)
    }
  })

  it("rejects a cursor whose id is not a string", () => {
    const forged = btoa(JSON.stringify({ field: "paidAt", value: null, id: 7 }))
    assert.equal(decodeExpenseCursor(forged), null)
  })

  it("caps the page size well below the per-trip expense cap", () => {
    assert.ok(EXPENSE_PAGE_SIZE_DEFAULT > 0)
    assert.ok(EXPENSE_PAGE_SIZE_DEFAULT <= EXPENSE_PAGE_SIZE_MAX)
    assert.ok(EXPENSE_PAGE_SIZE_MAX <= 200)
  })
})
