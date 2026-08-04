/**
 * Equal-split settlement for a trip's expenses.
 *
 * Pure and standalone so it can be tested — it previously lived as a computed
 * inside ExpenseTracker.vue, where the bug below went unnoticed.
 *
 * An expense counts toward the split only when its payer is a known member.
 * Anything else (no `paidById`, or a payer who has since left the trip) is
 * reported separately as `unattributedTotal` rather than silently dropped:
 * the old version excluded it from the settlement while the header total still
 * counted it, so the two numbers disagreed with nothing to explain the gap.
 */

export interface SettlementMember {
  userId: string
  user: { name: string }
}

export interface SettlementExpense {
  amount: string
  paidById?: string | null
}

export interface SettlementBalance {
  userId: string
  name: string
  /** Positive = owed money, negative = owes money. */
  balance: number
}

export interface Settlement {
  balances: SettlementBalance[]
  /** Sum of expenses whose payer is a known member — what the balances split. */
  attributedTotal: number
  /** Sum of expenses with no identifiable payer, surfaced so totals reconcile. */
  unattributedTotal: number
}

/** Balances below this are treated as settled, absorbing float noise. */
const SETTLED_EPSILON = 0.01

export function computeSettlement(
  expenses: readonly SettlementExpense[],
  members: readonly SettlementMember[],
): Settlement {
  const empty: Settlement = { balances: [], attributedTotal: 0, unattributedTotal: 0 }
  if (members.length < 2) return empty

  const paid = new Map<string, number>(members.map((m) => [m.userId, 0]))
  let attributedTotal = 0
  let unattributedTotal = 0

  for (const expense of expenses) {
    const amount = parseFloat(expense.amount)
    if (!Number.isFinite(amount)) continue
    const payerId = expense.paidById
    if (payerId != null && paid.has(payerId)) {
      paid.set(payerId, (paid.get(payerId) ?? 0) + amount)
      attributedTotal += amount
    } else {
      unattributedTotal += amount
    }
  }

  if (attributedTotal === 0) return { balances: [], attributedTotal: 0, unattributedTotal }

  const fairShare = attributedTotal / members.length
  const balances = members
    .map((m) => ({
      userId: m.userId,
      name: m.user.name,
      balance: (paid.get(m.userId) ?? 0) - fairShare,
    }))
    .filter((b) => Math.abs(b.balance) > SETTLED_EPSILON)

  return { balances, attributedTotal, unattributedTotal }
}
