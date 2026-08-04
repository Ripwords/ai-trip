import { eq } from "drizzle-orm"
import { db } from "../../../../db"
import { expenses, trips } from "../../../../db/schema"
import { uuidParamsSchema, createExpenseSchema } from "../../../../utils/schemas"
import { assertExpenseRefs } from "../../../../lib/expenses"
import { reserveExpenseSlot } from "../../../../lib/expense-cap"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, createExpenseSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Shared with the PUT handler — see server/lib/expenses.ts.
  await assertExpenseRefs(id, { activityId: body.activityId, paidById: body.paidById })

  // The per-trip cap. Reserving the slot and writing the row in one transaction
  // means a failed insert gives the slot back, and the reservation itself is a
  // single conditional UPDATE rather than the `count(*)` this used to run on
  // every write — see server/lib/expense-cap.ts.
  const expense = await db.transaction(async (tx) => {
    await reserveExpenseSlot(id, tx)

    const [row] = await tx
      .insert(expenses)
      .values({
        ...body,
        tripId: id,
        // paid_at is a `date` column — a plain YYYY-MM-DD string, no Date round-trip.
        paidAt: body.paidAt ?? undefined,
      })
      .returning()

    return row
  })

  // Audit log. The currency comes from the trip — this line used to hardcode
  // "$", permanently misreporting every expense on a non-USD trip.
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    columns: { currencyCode: true },
  })
  const currency = trip?.currencyCode || "USD"
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "expense_added",
    description: `Added expense: ${body.description} (${body.amount} ${currency})`,
    metadata: { expenseId: expense?.id, amount: body.amount, currency },
  })

  return expense
})
