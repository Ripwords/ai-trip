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
 * 2. **Transfers, not just balances** (#36). "Alice is +120, Bob is -80" left
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
  /** What was paid. Denominated in the trip's currency. */
  amount: string
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
  }
  if (members.length < 2) return empty

  const memberIds = members.map((m) => m.userId)
  const memberIdSet = new Set(memberIds)

  const paid = new Map<string, number>(memberIds.map((id) => [id, 0]))
  const owed = new Map<string, number>(memberIds.map((id) => [id, 0]))
  let attributedMinor = 0
  let unattributedMinor = 0

  for (const expense of expenses) {
    const amountMinor = toMinorUnits(expense.amount, tripCurrencyCode)
    if (amountMinor == null) continue

    const payerId = expense.paidById
    if (payerId == null || !memberIdSet.has(payerId)) {
      unattributedMinor += amountMinor
      continue
    }

    paid.set(payerId, (paid.get(payerId) ?? 0) + amountMinor)
    attributedMinor += amountMinor

    const shares = shareOut(expense, amountMinor, memberIds, tripCurrencyCode)
    for (const [userId, shareMinor] of Object.entries(shares)) {
      owed.set(userId, (owed.get(userId) ?? 0) + shareMinor)
    }
  }

  if (attributedMinor === 0) {
    return { ...empty, unattributedTotal: minorToNumber(unattributedMinor, tripCurrencyCode) }
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
  }
}

/**
 * Who owes what for one expense, in trip-currency minor units.
 *
 * Stored splits are applied as **ratios** against the expense total rather than
 * used as amounts directly, so they reconcile exactly by construction even when
 * the stored figures were resolved against a different total.
 *
 * Participants who are no longer members are dropped and their share spread
 * over whoever remains: an uncollectable share would leave the balances not
 * summing to zero, and the transfer solver rejects that.
 */
function shareOut(
  expense: SettlementExpense,
  amountMinor: number,
  memberIds: readonly string[],
  tripCurrencyCode: string,
): Record<string, number> {
  const stored = expense.splits
  if (stored) {
    const participantIds: string[] = []
    const weights: Record<string, number> = {}
    for (const [userId, text] of Object.entries(stored)) {
      if (!memberIds.includes(userId)) continue
      const weight = toMinorUnits(text, tripCurrencyCode)
      if (weight == null || weight <= 0) continue
      participantIds.push(userId)
      weights[userId] = weight
    }
    if (participantIds.length > 0) {
      return resolveSplits({ amountMinor, mode: "shares", participantIds, values: weights })
    }
  }

  return resolveSplits({ amountMinor, mode: "equal", participantIds: memberIds })
}

function minorToNumber(minor: number, currencyCode: string): number {
  return Number(fromMinorUnits(minor, currencyCode))
}
