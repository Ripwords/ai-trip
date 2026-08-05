/**
 * Resolving an expense into per-person amounts.
 *
 * `expenses.splits` has existed (typed, documented) since the table was
 * created and nothing ever wrote it — the tracker hardcoded an equal split
 * across every active member, so a taxi two people shared was charged to all
 * five. This module is the maths that column was always meant to hold.
 *
 * Everything is in minor units (see ./money) and every mode reconciles
 * *exactly* to the expense total: the largest-remainder method hands leftover
 * cents to real participants instead of rounding them into nowhere.
 */

import { fromMinorUnits, toMinorUnits } from "./money"

export const SPLIT_MODES = ["equal", "exact", "shares", "percent"] as const
export type SplitMode = (typeof SPLIT_MODES)[number]

export interface ResolveSplitsInput {
  /** The expense total, in the expense's own currency's minor units. */
  amountMinor: number
  mode: SplitMode
  /** Who actually shared this expense — not necessarily every trip member. */
  participantIds: readonly string[]
  /**
   * Per-participant input, meaning depends on `mode`:
   * `shares` = weights, `percent` = percentages, `exact` = minor units.
   * Ignored for `equal`.
   */
  values?: Readonly<Record<string, number>>
}

/** Per-participant amounts in minor units, summing exactly to `amountMinor`. */
export type ResolvedSplits = Record<string, number>

export function resolveSplits(input: ResolveSplitsInput): ResolvedSplits {
  const { amountMinor, mode, participantIds, values } = input
  if (participantIds.length === 0) return {}

  if (mode === "exact") {
    const result: ResolvedSplits = {}
    let total = 0
    for (const id of participantIds) {
      const v = Math.round(values?.[id] ?? 0)
      result[id] = v
      total += v
    }
    if (total !== amountMinor) {
      throw new Error(`Exact splits must sum to the expense amount (${total} ≠ ${amountMinor})`)
    }
    return result
  }

  const weights = participantIds.map((id) => {
    if (mode === "equal") return 1
    const v = values?.[id] ?? 0
    // Negative weights are meaningless and would let one person's share
    // silently inflate everyone else's; clamp rather than throw.
    return Number.isFinite(v) && v > 0 ? v : 0
  })

  const weightTotal = weights.reduce((a, b) => a + b, 0)
  // All-zero weights (e.g. a percent form submitted empty) would divide by
  // zero. Degrade to an equal split rather than producing NaN.
  const effective = weightTotal > 0 ? weights : participantIds.map(() => 1)
  const effectiveTotal = weightTotal > 0 ? weightTotal : participantIds.length

  return distributeByLargestRemainder(amountMinor, participantIds, effective, effectiveTotal)
}

/**
 * Hamilton's method: give everyone their floor, then hand the leftover units
 * out one at a time to the largest fractional remainders (ties broken by
 * original order, so the result is deterministic).
 */
function distributeByLargestRemainder(
  amountMinor: number,
  ids: readonly string[],
  weights: readonly number[],
  weightTotal: number,
): ResolvedSplits {
  const exact = ids.map((id, i) => {
    const share = (amountMinor * (weights[i] ?? 0)) / weightTotal
    const floor = Math.floor(share)
    return { id, floor, remainder: share - floor, index: i }
  })

  let leftover = amountMinor - exact.reduce((sum, e) => sum + e.floor, 0)

  const byRemainder = [...exact].toSorted((a, b) => b.remainder - a.remainder || a.index - b.index)
  // `leftover` can be negative when the amount is negative (a refund), so step
  // toward zero in whichever direction is needed.
  const step = leftover < 0 ? -1 : 1
  for (let i = 0; leftover !== 0 && i < byRemainder.length; i++) {
    const entry = byRemainder[i]
    if (!entry) break
    entry.floor += step
    leftover -= step
  }

  const result: ResolvedSplits = {}
  for (const e of exact) result[e.id] = e.floor
  return result
}

/** Render resolved splits for storage in the `splits` jsonb column. */
export function splitsToStrings(
  splits: ResolvedSplits,
  currencyCode: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, minor] of Object.entries(splits)) {
    out[id] = fromMinorUnits(minor, currencyCode)
  }
  return out
}

/** Parse a stored `splits` map back into integers, skipping malformed entries. */
export function splitsToMinorUnits(
  splits: Readonly<Record<string, string>>,
  currencyCode: string,
): ResolvedSplits {
  const out: ResolvedSplits = {}
  for (const [id, text] of Object.entries(splits)) {
    const minor = toMinorUnits(text, currencyCode)
    if (minor != null) out[id] = minor
  }
  return out
}
