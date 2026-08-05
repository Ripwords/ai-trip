import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { computeSettlement } from "./settlement"
import type { Settlement, SettlementExpense, SettlementMember } from "./settlement"

const members: SettlementMember[] = [
  { userId: "a", user: { name: "Alice" } },
  { userId: "b", user: { name: "Bob" } },
]

const trio: SettlementMember[] = [...members, { userId: "c", user: { name: "Carol" } }]

/**
 * `amountInTripCurrency` is NOT NULL in the schema and is the settlement's only
 * unit of account, so it always has to be supplied. For a same-currency expense
 * it equals `amount`; a foreign expense must override it explicitly.
 */
const e = (
  amount: string,
  paidById: string | null,
  extra: Partial<SettlementExpense> = {},
): SettlementExpense => ({ amount, amountInTripCurrency: amount, paidById, ...extra })

/** Every settlement must be zero-sum — `simplifyDebts` depends on it. */
const assertZeroSum = (s: Settlement) => {
  assert.equal(
    s.balances.reduce((sum, b) => sum + b.balanceMinor, 0),
    0,
    "balances must sum to zero",
  )
}

const balanceOf = (s: Settlement, userId: string) =>
  s.balances.find((b) => b.userId === userId)?.balance ?? 0

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
    assert.equal(s.uncollectableTotal, 0)
    assertZeroSum(s)
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
    assertZeroSum(s)
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
    assertZeroSum(s)
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
    assert.equal(s.uncollectableTotal, 0)
    assertZeroSum(s)
  })

  // Previously the departed member's share was redistributed over whoever
  // stayed, so Bob's debt grew from the £30 he agreed to to £45 for doing
  // nothing — and in the two-person case it vanished entirely with nothing
  // explaining the gap. A departed member's share is uncollectable, not
  // transferable: the payer fronted the money and bears it.
  it("charges a departed participant's share to the payer, not to whoever stayed", () => {
    const s = computeSettlement(
      [e("90.00", "a", { splits: { a: "30.00", b: "30.00", gone: "30.00" } })],
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
    assert.equal(s.uncollectableTotal, 30)
    assert.equal(s.attributedTotal, 90)
    assertZeroSum(s)
  })

  it("leaves the surviving participants' proportions untouched when someone leaves", () => {
    // 90 split 10/20/60; `gone` walks off with 60% of it.
    const s = computeSettlement(
      [e("90.00", "a", { splits: { a: "9.00", b: "18.00", gone: "63.00" } })],
      members,
      "USD",
    )
    assert.equal(balanceOf(s, "b"), -18)
    assert.equal(balanceOf(s, "a"), 18)
    assert.equal(s.uncollectableTotal, 63)
    assertZeroSum(s)
  })

  // Issue #35 exists precisely because expenses were split equally across
  // everyone regardless of who shared them. Falling back to an equal split
  // here reintroduced that bug for any expense whose participants have all
  // left: Bob and Carol would be billed for something they provably did not
  // share. Never re-split — the payer absorbs the whole thing.
  it("charges the payer the whole amount when no split participant is still a member", () => {
    const s = computeSettlement([e("90.00", "a", { splits: { x: "90.00" } })], trio, "USD")
    assert.deepEqual(s.balances, [])
    assert.equal(balanceOf(s, "b"), 0)
    assert.equal(balanceOf(s, "c"), 0)
    assert.equal(s.uncollectableTotal, 90)
    assert.equal(s.attributedTotal, 90)
    assertZeroSum(s)
  })

  it("keeps a surviving participant recorded at a zero share instead of dropping them", () => {
    const s = computeSettlement(
      [e("60.00", "a", { splits: { a: "30.00", b: "30.00", c: "0.00" } })],
      trio,
      "USD",
    )
    assert.equal(balanceOf(s, "a"), 30)
    assert.equal(balanceOf(s, "b"), -30)
    assert.equal(balanceOf(s, "c"), 0)
    assert.equal(s.uncollectableTotal, 0)
    assertZeroSum(s)
  })

  it("treats an all-zero stored split as uncollectable rather than dividing by zero", () => {
    const s = computeSettlement(
      [e("50.00", "a", { splits: { a: "0.00", b: "0.00" } })],
      members,
      "USD",
    )
    assert.deepEqual(s.balances, [])
    assert.equal(s.uncollectableTotal, 50)
    assertZeroSum(s)
  })

  it("reports no uncollectable amount for an ordinary split", () => {
    const s = computeSettlement(
      [e("100.00", "a", { splits: { a: "70.00", b: "30.00" } })],
      members,
      "USD",
    )
    assert.equal(s.uncollectableTotal, 0)
    assertZeroSum(s)
  })

  it("keeps balances summing to zero on a three-way split of an odd amount", () => {
    const s = computeSettlement([e("100.00", "a")], trio, "USD")
    assertZeroSum(s)
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
    assertZeroSum(s)
  })

  // The regression this guards: reading `amount` as if it were trip currency
  // turned a ¥3,200 expense into $3,200.00 on a USD trip, 100x over.
  it("never falls back to the raw foreign amount", () => {
    const s = computeSettlement(
      [e("3200", "a", { currencyCode: "JPY", amountInTripCurrency: "20.00" })],
      members,
      "USD",
    )
    assert.notEqual(s.attributedTotal, 3200)
    assert.equal(s.attributedTotal, 20)
  })

  it("settles a legacy row with no recorded provenance on its trip-currency projection", () => {
    const s = computeSettlement(
      [{ amount: "40.00", amountInTripCurrency: "40.00", currencyCode: null, paidById: "a" }],
      members,
      "USD",
    )
    assert.equal(s.attributedTotal, 40)
    assert.deepEqual(
      s.balances.map((b) => b.balance),
      [20, -20],
    )
    assertZeroSum(s)
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
