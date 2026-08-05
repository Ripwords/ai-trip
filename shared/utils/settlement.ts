/**
 * Settlement for a trip's expenses: who owes what, and who should pay whom.
 *
 * Pure and standalone so it can be tested — it originally lived as a computed
 * inside ExpenseTracker.vue, where several of the bugs below went unnoticed.
 * It sits in `shared/` because the summary endpoint and the tracker both need
 * the same numbers; two implementations is how they disagreed in the first
 * place.
 *
 * Three things this fixes:
 *
 * 1. **Splits are honoured** (#35). The old version divided every expense
 *    equally across every active member, ignoring `expenses.splits` entirely,
 *    so a taxi two of five people took was billed to all five.
 * 2. **Multi-currency** (#47). Expenses carry their own currency; settlement
 *    reports in the trip currency via the derived `amountInTripCurrency`,
 *    never the raw foreign figure.
 * 3. **Transfers, not just balances** (#36). "Alice is +120, Bob is -80" left
 *    the group doing the arithmetic by hand.
 *
 * All arithmetic is in integer minor units (see ./money) so the transfers
 * reconcile against the balances to the cent, with nothing invented or lost.
 *
 * An expense counts toward the split only when its payer is a known member.
 * Anything else (no `paidById`, or a payer who has since left the trip) is
 * reported separately as `unattributedTotal` rather than silently dropped:
 * the old version excluded it from the settlement while the header total still
 * counted it, so the two numbers disagreed with nothing to explain the gap.
 */

import { simplifyDebts } from "./debt-simplify"
import { fromMinorUnits, toMinorUnits } from "./money"
import { resolveSplits } from "./splits"

export interface SettlementMember {
  userId: string
  user: { name: string }
}

export interface SettlementExpense {
  /** What was paid, in `currencyCode`. Never read as a trip-currency figure. */
  amount: string
  /**
   * The expense's own currency. NULL means the provenance was never recorded
   * (rows predating #47); their stored `splits` are in that same unknown
   * denomination, so the trip currency is the right unit to parse them with.
   */
  currencyCode?: string | null
  /**
   * The derived trip-currency projection — always populated, and the
   * settlement's only unit of account. There is deliberately no fallback to
   * `amount`: `amount` is in the *expense's* currency, so reading it as trip
   * currency is how a ¥3,200 row on a USD trip became $3,200.00.
   */
  amountInTripCurrency: string
  paidById?: string | null
  /** Resolved per-participant amounts; null means "equal across all members". */
  splits?: Record<string, string> | null
}

export interface SettlementBalance {
  userId: string
  name: string
  /** Positive = owed money, negative = owes money. Trip currency, minor units. */
  balanceMinor: number
  /** The same figure in major units, for display. */
  balance: number
}

export interface SettlementTransfer {
  fromUserId: string
  fromName: string
  toUserId: string
  toName: string
  amountMinor: number
  amount: number
}

export interface Settlement {
  balances: SettlementBalance[]
  /** A minimal set of payments that clears every balance. */
  transfers: SettlementTransfer[]
  /** Sum of expenses whose payer is a known member — what the balances split. */
  attributedTotal: number
  /** Sum of expenses with no identifiable payer, surfaced so totals reconcile. */
  unattributedTotal: number
  /**
   * Shares belonging to split participants who have since left the trip. Their
   * debt is uncollectable, not transferable — nobody who stayed agreed to it —
   * so the payer bears it. Surfaced here so the amount is explained rather than
   * silently absorbed into the payer's balance.
   */
  uncollectableTotal: number
}

export function computeSettlement(
  expenses: readonly SettlementExpense[],
  members: readonly SettlementMember[],
  tripCurrencyCode: string,
): Settlement {
  const empty: Settlement = {
    balances: [],
    transfers: [],
    attributedTotal: 0,
    unattributedTotal: 0,
    uncollectableTotal: 0,
  }
  if (members.length < 2) return empty

  const memberIds = members.map((m) => m.userId)
  const memberIdSet = new Set(memberIds)

  const paid = new Map<string, number>(memberIds.map((id) => [id, 0]))
  const owed = new Map<string, number>(memberIds.map((id) => [id, 0]))
  let attributedMinor = 0
  let unattributedMinor = 0
  let uncollectableMinor = 0

  for (const expense of expenses) {
    // The trip-currency projection is the settlement's unit of account, and
    // the only one: `amount` is denominated in the expense's own currency, so
    // falling back to it would read a ¥3,200 row as $3,200.00. The column is
    // NOT NULL, but this is fed by JSON at runtime, so a missing projection is
    // skipped the same way an unparseable one is rather than throwing.
    const projection = expense.amountInTripCurrency
    const amountMinor =
      typeof projection === "string" ? toMinorUnits(projection, tripCurrencyCode) : null
    if (amountMinor == null) continue

    const payerId = expense.paidById
    if (payerId == null || !memberIdSet.has(payerId)) {
      unattributedMinor += amountMinor
      continue
    }

    paid.set(payerId, (paid.get(payerId) ?? 0) + amountMinor)
    attributedMinor += amountMinor

    const { shares, residueMinor } = shareOut(expense, amountMinor, memberIds, tripCurrencyCode)
    for (const [userId, shareMinor] of Object.entries(shares)) {
      owed.set(userId, (owed.get(userId) ?? 0) + shareMinor)
    }
    // Departed participants' shares fall to the payer, who fronted the money.
    // That keeps the balances summing to zero without billing anyone for an
    // expense they did not share.
    if (residueMinor !== 0) {
      owed.set(payerId, (owed.get(payerId) ?? 0) + residueMinor)
      uncollectableMinor += residueMinor
    }
  }

  if (attributedMinor === 0) {
    return {
      ...empty,
      unattributedTotal: minorToNumber(unattributedMinor, tripCurrencyCode),
      uncollectableTotal: minorToNumber(uncollectableMinor, tripCurrencyCode),
    }
  }

  const balances = members
    .map((m) => {
      const balanceMinor = (paid.get(m.userId) ?? 0) - (owed.get(m.userId) ?? 0)
      return {
        userId: m.userId,
        name: m.user.name,
        balanceMinor,
        balance: minorToNumber(balanceMinor, tripCurrencyCode),
      }
    })
    .filter((b) => b.balanceMinor !== 0)

  const nameById = new Map(members.map((m) => [m.userId, m.user.name]))
  const transfers = simplifyDebts(
    Object.fromEntries(balances.map((b) => [b.userId, b.balanceMinor])),
  ).map((t) => ({
    fromUserId: t.fromUserId,
    fromName: nameById.get(t.fromUserId) ?? "",
    toUserId: t.toUserId,
    toName: nameById.get(t.toUserId) ?? "",
    amountMinor: t.amountMinor,
    amount: minorToNumber(t.amountMinor, tripCurrencyCode),
  }))

  return {
    balances,
    transfers,
    attributedTotal: minorToNumber(attributedMinor, tripCurrencyCode),
    unattributedTotal: minorToNumber(unattributedMinor, tripCurrencyCode),
    uncollectableTotal: minorToNumber(uncollectableMinor, tripCurrencyCode),
  }
}

interface ShareOut {
  /** Trip-currency minor units owed, keyed by current member. */
  shares: Record<string, number>
  /** The part nobody on the trip owes — the payer absorbs it. */
  residueMinor: number
}

/**
 * Who owes what for one expense, in trip-currency minor units.
 *
 * Stored splits are recorded in the expense's *own* currency, so they can't be
 * used as trip-currency figures directly — converting each share separately
 * would round each one and they would no longer add up. They are applied as
 * **ratios** against the trip-currency total instead, which reconciles exactly
 * by construction.
 *
 * Departed participants keep their place in that ratio: the denominator is the
 * *full* original weight total, not just the survivors'. The old version
 * dropped them and renormalised over whoever stayed, so on a £90 30/30/30 with
 * one person gone Bob's debt grew from £30 to £45 for doing nothing, and on a
 * two-person trip it disappeared with nothing explaining the gap. A departed
 * member's share is uncollectable, not transferable — it comes back as
 * `residueMinor` and lands on the payer, who is the one actually out of pocket.
 *
 * When no stored participant is still a member the whole amount is residue.
 * The old fallback re-split it equally across current members, which is exactly
 * the bug #35 was filed to kill: billing people for an expense they provably
 * did not share. `splits: null` is different — that genuinely means "equal
 * across all current members" and is the intended default.
 */
function shareOut(
  expense: SettlementExpense,
  amountMinor: number,
  memberIds: readonly string[],
  tripCurrencyCode: string,
): ShareOut {
  const stored = expense.splits
  if (!stored) {
    return {
      shares: resolveSplits({ amountMinor, mode: "equal", participantIds: memberIds }),
      residueMinor: 0,
    }
  }

  // A legacy row with no recorded currency has its splits written in that same
  // unknown denomination, so parsing them at the trip currency's precision is
  // the right call — and it is only ever used as a ratio anyway.
  const expenseCurrency = expense.currencyCode ?? tripCurrencyCode
  const participantIds: string[] = []
  const weights: Record<string, number> = {}
  let weightTotal = 0
  let survivors = 0
  for (const [userId, text] of Object.entries(stored)) {
    const weight = toMinorUnits(text, expenseCurrency)
    // A 0.00 share is a real participant who owes nothing; only malformed or
    // negative entries are dropped.
    if (weight == null || weight < 0) continue
    participantIds.push(userId)
    weights[userId] = weight
    weightTotal += weight
    if (memberIds.includes(userId)) survivors++
  }

  // Nobody left to charge, or a split that allocates nothing to anyone. Either
  // way the payer bears it — never divide by zero, never re-split.
  if (survivors === 0 || weightTotal === 0) {
    return { shares: {}, residueMinor: amountMinor }
  }

  // Resolve across *all* recorded participants so the largest-remainder
  // distribution still reconciles exactly to `amountMinor`, then peel the
  // departed members' cents off as residue.
  const resolved = resolveSplits({ amountMinor, mode: "shares", participantIds, values: weights })
  const shares: Record<string, number> = {}
  let residueMinor = 0
  for (const [userId, shareMinor] of Object.entries(resolved)) {
    if (memberIds.includes(userId)) shares[userId] = shareMinor
    else residueMinor += shareMinor
  }
  return { shares, residueMinor }
}

function minorToNumber(minor: number, currencyCode: string): number {
  return Number(fromMinorUnits(minor, currencyCode))
}
