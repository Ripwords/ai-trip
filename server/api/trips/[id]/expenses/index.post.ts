import { eq, sql } from "drizzle-orm"
import { db } from "../../../../db"
import { expenses, trips } from "../../../../db/schema"
import { uuidParamsSchema, createExpenseSchema } from "../../../../utils/schemas"
import { assertExpenseRefs } from "../../../../lib/expenses"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, createExpenseSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Check per-trip expense limit
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(expenses)
    .where(eq(expenses.tripId, id))
  if (count >= 200) {
    throw createError({
      statusCode: 400,
      message: "Maximum number of expenses per trip reached (200)",
    })
  }

  // Shared with the PUT handler — see server/lib/expenses.ts.
  await assertExpenseRefs(id, { activityId: body.activityId, paidById: body.paidById })

  const [expense] = await db
    .insert(expenses)
    .values({
      ...body,
      tripId: id,
      // paid_at is a `date` column — a plain YYYY-MM-DD string, no Date round-trip.
      paidAt: body.paidAt ?? undefined,
    })
    .returning()

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
