import { and, eq } from "drizzle-orm"
import { db } from "../../../../db"
import { expenses, trips } from "../../../../db/schema"
import { expenseIdParamsSchema, updateExpenseSchema } from "../../../../utils/schemas"
import {
  assertExpenseRefs,
  listSettlementMembers,
  resolveExpenseSplits,
} from "../../../../lib/expenses"
import { toMinorUnits } from "../../../../../shared/utils/money"
import type { SplitMode } from "../../../../../shared/utils/splits"

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
  const currencyCode = trip?.currencyCode || "USD"

  const amount = body.amount ?? expense.amount
  const moneyChanged = body.amount !== undefined

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
      splitMode = body.splitMode ?? "equal"
      splits = resolveExpenseSplits({
        amount,
        currencyCode,
        splitMode,
        participantIds: body.participantIds,
        splitValues: body.splitValues,
        memberIds,
      })
    } else if (expense.splits) {
      // Only the amount moved. The stored splits are resolved amounts against
      // the *old* total, so leaving them would leave the expense not adding up.
      // Re-resolving with the old amounts as weights preserves the proportions
      // the user chose without needing to have kept the raw inputs.
      splitMode = expense.splitMode as SplitMode
      const previous = Object.fromEntries(
        Object.entries(expense.splits).flatMap(([userId, text]) => {
          const minor = toMinorUnits(text, currencyCode)
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
      before: { amount: expense.amount, category: expense.category },
      after: { amount: updated?.amount, category: updated?.category },
    },
  })

  return updated
})
