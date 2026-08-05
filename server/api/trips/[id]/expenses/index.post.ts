import { eq } from "drizzle-orm"
import { db } from "../../../../db"
import { expenses, trips } from "../../../../db/schema"
import { uuidParamsSchema, createExpenseSchema } from "../../../../utils/schemas"
import {
  assertExpenseRefs,
  listSettlementMembers,
  resolveExpenseSplits,
} from "../../../../lib/expenses"
import { reserveExpenseSlot } from "../../../../lib/expense-cap"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, createExpenseSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Shared with the PUT handler — see server/lib/expenses.ts.
  await assertExpenseRefs(id, { activityId: body.activityId, paidById: body.paidById })

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    columns: { currencyCode: true },
  })
  const currencyCode = trip?.currencyCode || "USD"

  // Resolving the split can reject the request and is cheaper than a
  // transaction, so it runs before the slot is reserved.
  const members = await listSettlementMembers(id)
  const splitMode = body.splitMode ?? "equal"
  const splits = resolveExpenseSplits({
    amount: body.amount,
    currencyCode,
    splitMode,
    participantIds: body.participantIds,
    splitValues: body.splitValues,
    memberIds: members.map((m) => m.userId),
  })

  // The per-trip cap. Reserving the slot and writing the row in one transaction
  // means a failed insert gives the slot back, and the reservation itself is a
  // single conditional UPDATE rather than the `count(*)` this used to run on
  // every write — see server/lib/expense-cap.ts.
  const expense = await db.transaction(async (tx) => {
    await reserveExpenseSlot(id, tx)

    const [row] = await tx
      .insert(expenses)
      .values({
        tripId: id,
        description: body.description,
        amount: body.amount,
        category: body.category,
        activityId: body.activityId ?? null,
        paidById: body.paidById ?? null,
        splitMode,
        splits,
        // paid_at is a `date` column — a plain YYYY-MM-DD string, no Date round-trip.
        paidAt: body.paidAt ?? undefined,
      })
      .returning()

    return row
  })

  // Audit log. The currency is the one actually paid in — this line used to
  // hardcode "$", permanently misreporting every expense on a non-USD trip.
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "expense_added",
    description: `Added expense: ${body.description} (${body.amount} ${currencyCode})`,
    metadata: {
      expenseId: expense?.id,
      amount: body.amount,
      currency: currencyCode,
    },
  })

  return expense
})
