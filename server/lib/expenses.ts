import { and, eq } from "drizzle-orm"
import { db } from "../db"
import { activities, tripMembers, trips } from "../db/schema"
import { minorUnitsFromNumber, toMinorUnits } from "../../shared/utils/money"
import { resolveSplits, splitsToStrings, type SplitMode } from "../../shared/utils/splits"

/** Database lookups, injectable so the rules below can be unit-tested. */
export interface ExpenseRefDeps {
  /** The trip an activity belongs to, or null when it doesn't exist. */
  findActivityTripId: (activityId: string) => Promise<string | null>
  /** The trip's owner id, or null when the trip doesn't exist. */
  findTripOwnerId: (tripId: string) => Promise<string | null>
  isActiveMember: (tripId: string, userId: string) => Promise<boolean>
}

const defaultDeps: ExpenseRefDeps = {
  findActivityTripId: async (activityId) => {
    const activity = await db.query.activities.findFirst({
      where: eq(activities.id, activityId),
      with: { day: true },
    })
    return activity?.day.tripId ?? null
  },
  findTripOwnerId: async (tripId) => {
    const trip = await db.query.trips.findFirst({
      where: eq(trips.id, tripId),
      columns: { userId: true },
    })
    return trip?.userId ?? null
  },
  isActiveMember: async (tripId, userId) => {
    const member = await db.query.tripMembers.findFirst({
      where: and(
        eq(tripMembers.tripId, tripId),
        eq(tripMembers.userId, userId),
        eq(tripMembers.status, "active"),
      ),
    })
    return member != null
  },
}

/**
 * Validate the two foreign references on an expense body against the trip it
 * is being written to.
 *
 * POST performed these checks inline; PUT performed neither, so an editor
 * could re-point an expense at an activity belonging to a *different* trip, or
 * set `paidById` to someone who is not a member — corrupting settlement, which
 * splits by member. Shared by both handlers so they cannot drift again.
 *
 * `undefined` means "not being changed" and is skipped; `null` clears the
 * reference and needs no validation.
 */
export async function assertExpenseRefs(
  tripId: string,
  refs: { activityId?: string | null; paidById?: string | null },
  deps: ExpenseRefDeps = defaultDeps,
): Promise<void> {
  if (refs.activityId) {
    const activityTripId = await deps.findActivityTripId(refs.activityId)
    if (activityTripId !== tripId) {
      throw createError({ statusCode: 404, message: "Activity not found" })
    }
  }

  if (refs.paidById) {
    const ownerId = await deps.findTripOwnerId(tripId)
    if (!ownerId) throw createError({ statusCode: 404, message: "Trip not found" })

    // Owners have no tripMembers row, so they must be allowed explicitly.
    if (refs.paidById !== ownerId && !(await deps.isActiveMember(tripId, refs.paidById))) {
      throw createError({ statusCode: 400, message: "Paid-by user is not a member of this trip" })
    }
  }
}

/**
 * Everyone who may appear in a split or as a payer: the owner (who has no
 * `tripMembers` row) plus every active member. The same set `computeSettlement`
 * divides across, so the two cannot drift.
 */
export async function listSettlementMembers(
  tripId: string,
): Promise<{ userId: string; user: { name: string } }[]> {
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    columns: { userId: true },
    with: { user: { columns: { id: true, name: true } } },
  })
  if (!trip) return []

  const members = await db.query.tripMembers.findMany({
    where: and(eq(tripMembers.tripId, tripId), eq(tripMembers.status, "active")),
    with: { user: { columns: { id: true, name: true } } },
  })

  const result = [{ userId: trip.userId, user: { name: trip.user.name } }]
  for (const m of members) {
    // `userId` is null for invites that haven't been accepted — they have an
    // email and no account yet, so they can't owe or be owed anything.
    if (m.userId == null || m.user == null || m.userId === trip.userId) continue
    result.push({ userId: m.userId, user: { name: m.user.name } })
  }
  return result
}

export interface ResolveExpenseSplitsInput {
  /** The expense total as submitted, in `currencyCode`. */
  amount: string
  currencyCode: string
  splitMode: SplitMode
  /**
   * Who actually shared the expense. Omitted means "everyone on the trip",
   * which is stored as NULL rather than a snapshot of today's roster.
   */
  participantIds?: readonly string[]
  /**
   * Per-participant input in *major* units / natural units for the mode:
   * `shares` = weights, `percent` = percentages, `exact` = money amounts.
   */
  splitValues?: Readonly<Record<string, number>>
  /** Everyone who may appear as a participant (owner + active members). */
  memberIds: readonly string[]
}

/**
 * Turn a request body into the `splits` column's stored value.
 *
 * Returns NULL when the expense is an equal split across the whole trip. That
 * is not laziness: storing a snapshot of the roster would mean an expense
 * added before someone joined keeps charging the old set forever, while NULL
 * lets `computeSettlement` divide across whoever is on the trip at read time —
 * exactly the behaviour that already shipped, now the explicit default rather
 * than the only option.
 *
 * Throws `createError` so the API handlers surface a 400 rather than a 500.
 */
export function resolveExpenseSplits(
  input: ResolveExpenseSplitsInput,
): Record<string, string> | null {
  const { amount, currencyCode, splitMode, participantIds, splitValues, memberIds } = input

  const amountMinor = toMinorUnits(amount, currencyCode)
  if (amountMinor == null) {
    throw createError({ statusCode: 400, message: `Expense amount "${amount}" is not a number` })
  }

  if (!participantIds || participantIds.length === 0) {
    if (splitMode !== "equal") {
      throw createError({
        statusCode: 400,
        message: `A ${splitMode} split needs an explicit participant list`,
      })
    }
    return null
  }

  const unknown = participantIds.find((id) => !memberIds.includes(id))
  if (unknown) {
    throw createError({
      statusCode: 400,
      message: "A split participant is not a member of this trip",
    })
  }

  // `exact` values arrive as money (35 meaning 35.00); every other mode's
  // values are unitless weights that resolveSplits normalises itself.
  const values =
    splitMode === "exact" && splitValues
      ? Object.fromEntries(
          Object.entries(splitValues).map(([id, v]) => [id, minorUnitsFromNumber(v, currencyCode)]),
        )
      : splitValues

  try {
    const resolved = resolveSplits({ amountMinor, mode: splitMode, participantIds, values })
    return splitsToStrings(resolved, currencyCode)
  } catch (error: unknown) {
    throw createError({
      statusCode: 400,
      message: error instanceof Error ? error.message : "Could not resolve expense splits",
    })
  }
}
