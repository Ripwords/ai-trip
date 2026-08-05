import { and, eq } from "drizzle-orm"
import { db } from "../../../../db"
import { expenses, trips } from "../../../../db/schema"
import { expenseIdParamsSchema, updateExpenseSchema } from "../../../../utils/schemas"
import {
  assertExpenseRefs,
  listSettlementMembers,
  projectToTripCurrency,
  resolveExpenseSplits,
} from "../../../../lib/expenses"
import { toMinorUnits } from "../../../../../shared/utils/money"
import { SPLIT_MODES, type SplitMode } from "../../../../../shared/utils/splits"

/**
 * `expenses.split_mode` is a plain `text` column, so nothing at the type level
 * stops a legacy or hand-edited row from holding something that is not a split
 * mode at all. This used to be `expense.splitMode as SplitMode` — a cast over
 * unvalidated data in the money path, which would then be written straight back
 * out. An unrecognised value degrades to "equal", the same default a row with
 * no split has.
 */
function storedSplitMode(value: string): SplitMode {
  // `find` rather than `includes` + a cast: this narrows for real.
  return SPLIT_MODES.find((mode) => mode === value) ?? "equal"
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, expenseId } = await getValidatedRouterParams(event, expenseIdParamsSchema.parse)
  const body = await readValidatedBody(event, updateExpenseSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Verify expense belongs to trip
  const expense = await db.query.expenses.findFirst({
    where: and(eq(expenses.id, expenseId), eq(expenses.tripId, id)),
  })

  if (!expense) {
    throw createError({ statusCode: 404, message: "Expense not found" })
  }

  // Without this, an editor could re-point the expense at an activity in a
  // different trip, or at a paidById who is not a member of this one. POST has
  // always checked both; PUT checked neither.
  await assertExpenseRefs(id, { activityId: body.activityId, paidById: body.paidById })

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    columns: { currencyCode: true },
  })
  const tripCurrency = trip?.currencyCode || "USD"

  const amount = body.amount ?? expense.amount
  // Re-derive rather than carry the old projection forward: either half of
  // (amount, currency) changing invalidates it, and a stale trip-currency
  // figure is exactly the silent misreport this model exists to prevent.
  const moneyChanged = body.amount !== undefined || body.currencyCode !== undefined

  // A pre-#47 row has NULL `currencyCode`: its denomination was never recorded
  // and migration 0041 deliberately refuses to guess one. Re-projecting it
  // means committing to a currency, and defaulting to the trip's here would
  // quietly re-introduce the very assumption that migration rejects — on an
  // edit the user did not think of as a currency decision.
  //
  // So ask. The edit form already sends `currencyCode` on every save, so this
  // is unreachable from the UI; it only catches a direct-API caller changing
  // the amount of a legacy row, where a 400 naming the problem is far better
  // than a silent stamp on a column #47 makes immutable.
  if (moneyChanged && expense.currencyCode == null && body.currencyCode === undefined) {
    throw createError({
      statusCode: 400,
      message:
        "This expense predates per-expense currencies and its currency was never recorded. Send `currencyCode` to state what it was paid in.",
    })
  }

  const currencyCode = body.currencyCode ?? expense.currencyCode ?? tripCurrency

  // Only ever used to pick the right number of decimals when re-parsing the
  // stored `splits` strings, which are denominated in whatever the row was.
  // Falling back to the trip's currency here asserts nothing about provenance —
  // it just decides whether "30" means 30 or 0.30.
  const storedCurrency = expense.currencyCode ?? tripCurrency

  const money = moneyChanged
    ? await projectToTripCurrency({ amount, currencyCode, tripCurrencyCode: tripCurrency })
    : null

  const splitInputChanged =
    body.splitMode !== undefined ||
    body.participantIds !== undefined ||
    body.splitValues !== undefined
  const splitsNeedResolving = splitInputChanged || moneyChanged

  let splitMode: SplitMode | undefined
  let splits: Record<string, string> | null | undefined

  if (splitsNeedResolving) {
    const memberIds = (await listSettlementMembers(id)).map((m) => m.userId)

    if (splitInputChanged) {
      // A PUT names only what it is changing, so an absent split field means
      // "unchanged", not "reset to the default". This used to default to
      // "equal" (and, with no participants, to NULL splits), so a body that
      // sent `splitValues` alone — exactly what the edit form does when only
      // the numbers move — wiped a 3-way percent split back to an equal one.
      // The fallback list is filtered to current members: a participant who
      // has since left the trip is a 400 when the *client* names them, but it
      // must not fail an edit that never mentioned the split at all.
      const participantIds =
        body.participantIds ??
        (expense.splits
          ? Object.keys(expense.splits).filter((userId) => memberIds.includes(userId))
          : [])
      // An empty participant list is "shared by everyone", which is only
      // expressible as an equal split — keeping the old mode there would store
      // a percent expense with no percentages.
      splitMode =
        participantIds.length === 0
          ? "equal"
          : (body.splitMode ?? storedSplitMode(expense.splitMode))
      // Every mode but `equal` needs a value per participant, and resolveSplits
      // refuses to guess when it has none. A body that moved the participants
      // without sending values has no proportions to honour, so the amounts are
      // divided evenly — but the mode the user chose is still what is stored.
      const mathsMode =
        body.splitValues === undefined && splitMode !== "equal" ? "equal" : splitMode
      splits = resolveExpenseSplits({
        amount,
        currencyCode,
        splitMode: mathsMode,
        participantIds,
        splitValues: body.splitValues,
        memberIds,
      })
    } else if (expense.splits) {
      // Only the money moved. The stored splits are resolved amounts against
      // the *old* total, so leaving them would leave the expense not adding up.
      // Re-resolving with the old amounts as weights preserves the proportions
      // the user chose without needing to have kept the raw inputs.
      splitMode = storedSplitMode(expense.splitMode)
      const previous = Object.fromEntries(
        Object.entries(expense.splits).flatMap(([userId, text]) => {
          const minor = toMinorUnits(text, storedCurrency)
          return minor != null && minor > 0 ? [[userId, minor] as const] : []
        }),
      )
      splits = resolveExpenseSplits({
        amount,
        currencyCode,
        splitMode: "shares",
        participantIds: Object.keys(previous).filter((u) => memberIds.includes(u)),
        splitValues: previous,
        memberIds,
      })
    }
  }

  const [updated] = await db
    .update(expenses)
    .set({
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.activityId !== undefined ? { activityId: body.activityId ?? null } : {}),
      ...(body.paidById !== undefined ? { paidById: body.paidById ?? null } : {}),
      ...(body.amount !== undefined ? { amount } : {}),
      // Written alongside fxRate, never on its own: the schema requires
      // `currency_code IS NULL` and `fx_rate IS NULL` to agree.
      ...(body.currencyCode !== undefined || money ? { currencyCode } : {}),
      ...(money ? { fxRate: money.fxRate, amountInTripCurrency: money.amountInTripCurrency } : {}),
      ...(splitMode !== undefined ? { splitMode } : {}),
      ...(splits !== undefined ? { splits } : {}),
      // paid_at is a `date` column — a plain YYYY-MM-DD string, no Date round-trip.
      ...(body.paidAt !== undefined ? { paidAt: body.paidAt ?? null } : {}),
    })
    .where(eq(expenses.id, expenseId))
    .returning()

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "expense_updated",
    description: `Updated expense: ${updated?.description ?? expense.description}`,
    metadata: {
      expenseId,
      before: {
        amount: expense.amount,
        currency: expense.currencyCode,
        category: expense.category,
      },
      after: {
        amount: updated?.amount,
        currency: updated?.currencyCode,
        category: updated?.category,
      },
    },
  })

  return updated
})
