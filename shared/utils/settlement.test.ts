import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { computeSettlement } from "./settlement"
import type { SettlementExpense, SettlementMember } from "./settlement"

const members: SettlementMember[] = [
  { userId: "a", user: { name: "Alice" } },
  { userId: "b", user: { name: "Bob" } },
]

const trio: SettlementMember[] = [...members, { userId: "c", user: { name: "Carol" } }]

const e = (
  amount: string,
  paidById: string | null,
  extra: Partial<SettlementExpense> = {},
): SettlementExpense => ({ amount, paidById, ...extra })

describe("computeSettlement", () => {
  it("splits an attributed expense evenly", () => {
    const s = computeSettlement([e("100.00", "a")], members, "USD")
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
    const s = computeSettlement([e("100.00", "a"), e("40.00", null)], members, "USD")
    assert.equal(s.unattributedTotal, 40)
    assert.equal(s.attributedTotal, 100)
    // Balances still only settle what is actually attributable.
    assert.deepEqual(
      s.balances.map((b) => b.balance),
      [50, -50],
    )
  })

  it("treats a payer who is not a member as unattributed", () => {
    const s = computeSettlement([e("60.00", "ghost")], members, "USD")
    assert.equal(s.unattributedTotal, 60)
    assert.equal(s.attributedTotal, 0)
    assert.deepEqual(s.balances, [])
  })

  it("returns nothing to settle for a solo trip", () => {
    const s = computeSettlement([e("100.00", "a")], [members[0]!], "USD")
    assert.deepEqual(s.balances, [])
    assert.equal(s.unattributedTotal, 0)
  })

  it("drops balances that are settled exactly", () => {
    const s = computeSettlement([e("50.00", "a"), e("50.00", "b")], members, "USD")
    assert.deepEqual(s.balances, [])
    assert.deepEqual(s.transfers, [])
  })

  it("ignores amounts that are not parseable numbers", () => {
    const s = computeSettlement([e("abc", "a"), e("100.00", "a")], members, "USD")
    assert.equal(s.attributedTotal, 100)
  })

  it("handles an empty expense list", () => {
    const s = computeSettlement([], members, "USD")
    assert.deepEqual(s.balances, [])
    assert.equal(s.attributedTotal, 0)
    assert.equal(s.unattributedTotal, 0)
  })
})

// Issue #35: the tracker hardcoded an equal split across every active member,
// so an expense two of five people shared was charged to all five.
describe("computeSettlement — stored splits", () => {
  it("charges only the participants named in splits", () => {
    const s = computeSettlement(
      [e("90.00", "a", { splits: { a: "45.00", b: "45.00" } })],
      trio,
      "USD",
    )
    // Carol wasn't on this expense, so she owes nothing and doesn't appear.
    assert.deepEqual(
      s.balances.map((b) => [b.userId, b.balance]),
      [
        ["a", 45],
        ["b", -45],
      ],
    )
  })

  it("honours an uneven stored split", () => {
    const s = computeSettlement(
      [e("100.00", "a", { splits: { a: "70.00", b: "30.00" } })],
      members,
      "USD",
    )
    assert.deepEqual(
      s.balances.map((b) => [b.userId, b.balance]),
      [
        ["a", 30],
        ["b", -30],
      ],
    )
  })

  it("falls back to an equal split when splits is null", () => {
    const s = computeSettlement([e("90.00", "a", { splits: null })], trio, "USD")
    assert.deepEqual(
      s.balances.map((b) => b.balance),
      [60, -30, -30],
    )
  })

  // A departed member's share can't be collected; redistributing over the
  // people still on the trip keeps the balances summing to zero, which the
  // transfer solver requires.
  it("redistributes over current members when a participant has left", () => {
    const s = computeSettlement(
      [e("90.00", "a", { splits: { a: "30.00", b: "30.00", gone: "30.00" } })],
      members,
      "USD",
    )
    assert.deepEqual(
      s.balances.map((b) => [b.userId, b.balance]),
      [
        ["a", 45],
        ["b", -45],
      ],
    )
  })

  it("falls back to equal when no split participant is still a member", () => {
    const s = computeSettlement([e("90.00", "a", { splits: { x: "90.00" } })], trio, "USD")
    assert.deepEqual(
      s.balances.map((b) => b.balance),
      [60, -30, -30],
    )
  })

  it("keeps balances summing to zero on a three-way split of an odd amount", () => {
    const s = computeSettlement([e("100.00", "a")], trio, "USD")
    const total = s.balances.reduce((sum, b) => sum + b.balanceMinor, 0)
    assert.equal(total, 0)
    assert.deepEqual(
      s.balances.map((b) => b.balanceMinor),
      [6666, -3333, -3333],
    )
  })
})

// Issue #47: expenses carry their own currency; the settlement reports in the
// trip's currency using the derived amount, never the raw foreign one.
describe("computeSettlement — multi-currency", () => {
  it("settles on amountInTripCurrency when the expense is foreign", () => {
    const s = computeSettlement(
      [e("3200", "a", { currencyCode: "JPY", amountInTripCurrency: "20.00" })],
      members,
      "USD",
    )
    assert.equal(s.attributedTotal, 20)
    assert.deepEqual(
      s.balances.map((b) => b.balance),
      [10, -10],
    )
  })

  it("applies stored splits as ratios so the trip-currency shares still reconcile", () => {
    const s = computeSettlement(
      [
        e("3000", "a", {
          currencyCode: "JPY",
          amountInTripCurrency: "20.01",
          splits: { a: "1000", b: "1000", c: "1000" },
        }),
      ],
      trio,
      "USD",
    )
    assert.equal(
      s.balances.reduce((sum, b) => sum + b.balanceMinor, 0),
      0,
    )
    assert.equal(s.attributedTotal, 20.01)
  })

  it("reports whole units for a zero-decimal trip currency", () => {
    const s = computeSettlement([e("3000", "a", { currencyCode: "JPY" })], members, "JPY")
    assert.deepEqual(
      s.balances.map((b) => b.balance),
      [1500, -1500],
    )
  })
})

// Issue #36: balances alone leave the group doing the arithmetic by hand.
describe("computeSettlement — transfers", () => {
  it("emits who pays whom for a two-person trip", () => {
    const s = computeSettlement([e("100.00", "a")], members, "USD")
    assert.deepEqual(s.transfers, [
      {
        fromUserId: "b",
        fromName: "Bob",
        toUserId: "a",
        toName: "Alice",
        amount: 50,
        amountMinor: 5000,
      },
    ])
  })

  it("settles a three-person trip in at most two transfers that reconcile", () => {
    const s = computeSettlement([e("120.00", "a"), e("30.00", "c")], trio, "USD")
    assert.ok(s.transfers.length <= 2)
    const net = new Map(s.balances.map((b) => [b.userId, b.balanceMinor]))
    for (const t of s.transfers) {
      net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) + t.amountMinor)
      net.set(t.toUserId, (net.get(t.toUserId) ?? 0) - t.amountMinor)
    }
    for (const [id, v] of net) assert.equal(v, 0, `${id} left at ${v}`)
  })

  it("emits no transfers when the unattributed portion is all there is", () => {
    const s = computeSettlement([e("40.00", null)], members, "USD")
    assert.deepEqual(s.transfers, [])
    assert.equal(s.unattributedTotal, 40)
  })
})
