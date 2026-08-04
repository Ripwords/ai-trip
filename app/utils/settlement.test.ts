import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { computeSettlement } from "./settlement"

const members = [
  { userId: "a", user: { name: "Alice" } },
  { userId: "b", user: { name: "Bob" } },
]

const e = (amount: string, paidById: string | null) => ({ amount, paidById })

describe("computeSettlement", () => {
  it("splits an attributed expense evenly", () => {
    const s = computeSettlement([e("100.00", "a")], members)
    assert.deepEqual(
      s.balances.map((b) => [b.userId, b.balance]),
      [
        ["a", 50],
        ["b", -50],
      ],
    )
    assert.equal(s.unattributedTotal, 0)
  })

  // The old computed summed only expenses with a known payer into `total`,
  // while the header total summed everything — so the settlement silently
  // disagreed with the number displayed directly above it.
  it("reports unattributed expenses instead of silently dropping them", () => {
    const s = computeSettlement([e("100.00", "a"), e("40.00", null)], members)
    assert.equal(s.unattributedTotal, 40)
    assert.equal(s.attributedTotal, 100)
    // Balances still only settle what is actually attributable.
    assert.deepEqual(
      s.balances.map((b) => b.balance),
      [50, -50],
    )
  })

  it("treats a payer who is not a member as unattributed", () => {
    const s = computeSettlement([e("60.00", "ghost")], members)
    assert.equal(s.unattributedTotal, 60)
    assert.equal(s.attributedTotal, 0)
    assert.deepEqual(s.balances, [])
  })

  it("returns nothing to settle for a solo trip", () => {
    const s = computeSettlement([e("100.00", "a")], [members[0]!])
    assert.deepEqual(s.balances, [])
    assert.equal(s.unattributedTotal, 0)
  })

  it("drops balances that are settled to within a cent", () => {
    const s = computeSettlement([e("50.00", "a"), e("50.00", "b")], members)
    assert.deepEqual(s.balances, [])
  })

  it("ignores amounts that are not parseable numbers", () => {
    const s = computeSettlement([e("abc", "a"), e("100.00", "a")], members)
    assert.equal(s.attributedTotal, 100)
  })

  it("handles an empty expense list", () => {
    const s = computeSettlement([], members)
    assert.deepEqual(s.balances, [])
    assert.equal(s.attributedTotal, 0)
    assert.equal(s.unattributedTotal, 0)
  })
})
