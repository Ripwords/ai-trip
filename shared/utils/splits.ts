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

/**
 * How far a `percent` split may drift from 100 before it is rejected.
 * Percentages arrive as JS numbers from a form, so 33.33 + 33.33 + 33.34
 * lands a hair off 100 and three thirds entered as 33.333 land 0.001 short.
 */
const PERCENT_TOLERANCE = 0.01

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
   *
   * Rejected with a plain `Error` (callers turn it into a 400) when the input
   * cannot be honoured as stated: negative or non-finite values in any mode,
   * `exact` values that don't sum to the amount, `percent` values that don't
   * sum to 100, or an all-zero `shares`/`percent` form. Nothing is silently
   * clamped or rescaled — a split the user did not ask for is a bug, not a
   * fallback.
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
    // A negative or NaN weight is never a typo the code should guess at: the
    // old version clamped it to 0, silently rewriting what the user stated.
    if (!Number.isFinite(v)) {
      throw new Error(`${mode} splits must be finite numbers (got ${String(v)} for "${id}")`)
    }
    if (v < 0) {
      throw new Error(`${mode} splits cannot be negative (got ${v} for "${id}")`)
    }
    return v
  })

  const weightTotal = weights.reduce((a, b) => a + b, 0)

  // Percentages are absolute, not relative: 50 + 30 means 20% is unallocated,
  // not "scale these up to fill the expense". Normalising them the way shares
  // are normalised turned 50/30 of 100.00 into 62.50/37.50, quietly
  // reallocating money the user deliberately left out. `exact` has always
  // rejected the analogous mismatch; `percent` now matches it. The tolerance
  // absorbs float dust from form inputs (33.33 x 3 = 99.99).
  if (mode === "percent" && Math.abs(weightTotal - 100) > PERCENT_TOLERANCE) {
    throw new Error(`Percent splits must sum to 100 (${weightTotal} ≠ 100)`)
  }

  // Shares are genuinely relative, so normalising them is correct — but an
  // all-zero form is a mistake, not an instruction to split equally.
  if (weightTotal <= 0) {
    throw new Error(`${mode} splits must include at least one non-zero value`)
  }

  return distributeByLargestRemainder(amountMinor, participantIds, weights, weightTotal)
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
