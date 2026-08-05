/**
 * Turn per-person balances into a minimal-ish set of "A pays B £X" transfers.
 *
 * The tracker used to stop at balances ("Alice is +120, Bob is -80"), leaving
 * the group to work out who actually hands money to whom — which is the exact
 * chore the feature exists to remove.
 *
 * Greedy largest-creditor / largest-debtor matching. Each pass fully settles at
 * least one person, so it terminates in at most n-1 transfers. (Finding the
 * true minimum is NP-hard — subset-sum in disguise — and greedy is optimal
 * often enough that the extra complexity buys nothing here.)
 *
 * Balances are in minor units so the transfers reconcile to the cent.
 */

export interface Transfer {
  fromUserId: string
  toUserId: string
  /** Always positive, in minor units. */
  amountMinor: number
}

/** @param balances positive = owed money, negative = owes money. */
export function simplifyDebts(balances: Readonly<Record<string, number>>): Transfer[] {
  const entries = Object.entries(balances).map(([userId, balance]) => ({
    userId,
    balance: Math.round(balance),
  }))

  const total = entries.reduce((sum, e) => sum + e.balance, 0)
  if (total !== 0) {
    // A non-zero total means the caller's split maths didn't reconcile. Failing
    // loudly beats emitting transfers that leave someone permanently short.
    throw new Error(`Balances must sum to zero, got ${total}`)
  }

  // Sorting by userId first makes the result deterministic when several people
  // hold identical balances, so the UI doesn't reshuffle between renders.
  const creditors = entries
    .filter((e) => e.balance > 0)
    .toSorted((a, b) => b.balance - a.balance || a.userId.localeCompare(b.userId))
  const debtors = entries
    .filter((e) => e.balance < 0)
    .toSorted((a, b) => a.balance - b.balance || a.userId.localeCompare(b.userId))

  const transfers: Transfer[] = []
  let ci = 0
  let di = 0

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]
    const debtor = debtors[di]
    if (!creditor || !debtor) break

    const amountMinor = Math.min(creditor.balance, -debtor.balance)
    if (amountMinor > 0) {
      transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountMinor })
      creditor.balance -= amountMinor
      debtor.balance += amountMinor
    }

    if (creditor.balance === 0) ci++
    if (debtor.balance === 0) di++
  }

  return transfers
}
