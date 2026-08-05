import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { simplifyDebts } = await import("./debt-simplify")

/** Applying the transfers to the balances must zero every one of them. */
function assertTransfersSettle(
  balances: Record<string, number>,
  transfers: readonly { fromUserId: string; toUserId: string; amountMinor: number }[],
) {
  const after = { ...balances }
  for (const t of transfers) {
    assert.ok(t.amountMinor > 0, "transfers must be positive")
    after[t.fromUserId] = (after[t.fromUserId] ?? 0) + t.amountMinor
    after[t.toUserId] = (after[t.toUserId] ?? 0) - t.amountMinor
  }
  for (const [id, v] of Object.entries(after)) {
    assert.equal(v, 0, `${id} left at ${v}`)
  }
}

describe("simplifyDebts", () => {
  it("emits nothing when everyone is already settled", () => {
    assert.deepEqual(simplifyDebts({ a: 0, b: 0, c: 0 }), [])
    assert.deepEqual(simplifyDebts({}), [])
  })

  it("emits a single transfer for a two-person trip", () => {
    const t = simplifyDebts({ a: 5000, b: -5000 })
    assert.deepEqual(t, [{ fromUserId: "b", toUserId: "a", amountMinor: 5000 }])
  })

  it("settles three people in two transfers", () => {
    // Alice fronted 120, Bob 0, Carol 30 on a 150 total -> 50 each.
    const balances = { alice: 7000, bob: -5000, carol: -2000 }
    const t = simplifyDebts(balances)
    assert.equal(t.length, 2)
    assertTransfersSettle(balances, t)
  })

  it("settles four people in at most n-1 transfers", () => {
    const balances = { a: 10000, b: 5000, c: -7000, d: -8000 }
    const t = simplifyDebts(balances)
    assert.ok(t.length <= 3, `expected <= 3 transfers, got ${t.length}`)
    assertTransfersSettle(balances, t)
  })

  it("ignores members sitting at exactly zero", () => {
    const balances = { a: 3000, b: -3000, c: 0 }
    const t = simplifyDebts(balances)
    assert.deepEqual(t, [{ fromUserId: "b", toUserId: "a", amountMinor: 3000 }])
  })

  // The whole point of doing this in integers: the transfers have to add up to
  // the balances with no cent invented or lost.
  it("loses no cent on a three-way split of an odd amount", () => {
    // 100.00 split three ways: 33.34 / 33.33 / 33.33, paid entirely by a.
    const balances = { a: 6666, b: -3333, c: -3333 }
    const t = simplifyDebts(balances)
    assertTransfersSettle(balances, t)
    assert.equal(
      t.reduce((s, x) => s + x.amountMinor, 0),
      6666,
    )
  })

  it("is deterministic for equal balances", () => {
    const balances = { a: 1000, b: 1000, c: -1000, d: -1000 }
    assert.deepEqual(simplifyDebts(balances), simplifyDebts(balances))
    assertTransfersSettle(balances, simplifyDebts(balances))
  })

  it("throws when the balances do not sum to zero", () => {
    assert.throws(() => simplifyDebts({ a: 100, b: -50 }), /sum to zero/i)
  })

  it("handles a long chain without emitting more than n-1 transfers", () => {
    const balances: Record<string, number> = {
      a: 100,
      b: 200,
      c: 300,
      d: -50,
      e: -150,
      f: -400,
    }
    const t = simplifyDebts(balances)
    assert.ok(t.length <= 5, `expected <= 5 transfers, got ${t.length}`)
    assertTransfersSettle(balances, t)
  })
})
