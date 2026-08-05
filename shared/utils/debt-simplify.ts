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
  const raw = Object.entries(balances)

  // Check the *unrounded* total. Rounding each balance first and then summing
  // rejects sets that genuinely reconcile: `{ a: 0.5, b: -0.5 }` sums to zero,
  // but Math.round takes it to `{ a: 1, b: -0 }`, total 1, and threw. Callers
  // pass integers today, so this was unreachable — but it sits on a GET path,
  // and "one panel is wrong" is a far better failure than "throw".
  const rawTotal = raw.reduce((sum, [, balance]) => sum + balance, 0)
  // A tolerance, not an equality: the input may have been through float
  // division. Anything above half a minor unit is a real reconciliation bug.
  if (Math.abs(rawTotal) >= 0.5) {
    // Failing loudly beats emitting transfers that leave someone permanently
    // short.
    throw new Error(`Balances must sum to zero, got ${rawTotal}`)
  }

  const entries = raw.map(([userId, balance]) => ({
    userId,
    balance: Math.round(balance),
    /** How far rounding moved this balance, so the residual lands fairly. */
    lift: Math.round(balance) - balance,
  }))

  // Rounding each balance can leave the integers not summing to zero even when
  // the inputs did. Take the residual off whichever balance rounding inflated
  // the most (ties by input order, so the result stays deterministic).
  let residual = entries.reduce((sum, e) => sum + e.balance, 0)
  const byLift = [...entries].toSorted((x, y) => y.lift - x.lift)
  const byDrop = [...entries].toSorted((x, y) => x.lift - y.lift)
  for (const e of residual > 0 ? byLift : byDrop) {
    if (residual === 0) break
    const step = residual > 0 ? -1 : 1
    e.balance += step
    residual += step
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
