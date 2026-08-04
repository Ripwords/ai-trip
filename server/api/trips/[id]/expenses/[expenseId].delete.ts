import { and, eq } from "drizzle-orm"
import { db } from "../../../../db"
import { expenses } from "../../../../db/schema"
import { expenseIdParamsSchema } from "../../../../utils/schemas"
import { releaseExpenseSlot } from "../../../../lib/expense-cap"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, expenseId } = await getValidatedRouterParams(event, expenseIdParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Verify expense belongs to trip
  const expense = await db.query.expenses.findFirst({
    where: and(eq(expenses.id, expenseId), eq(expenses.tripId, id)),
  })

  if (!expense) {
    throw createError({ statusCode: 404, message: "Expense not found" })
  }

  // Both statements or neither: the trip's expense counter is what the 200-row
  // cap is enforced against, so a delete that didn't give its slot back would
  // turn the cap into a lifetime quota.
  await db.transaction(async (tx) => {
    await tx.delete(expenses).where(eq(expenses.id, expenseId))
    await releaseExpenseSlot(id, tx)
  })

  // Expenses drive settlement — i.e. who owes whom real money — so a
  // collaborator deleting someone else's row must leave a trace. Only POST
  // used to log.
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "expense_deleted",
    description: `Deleted expense: ${expense.description}`,
    metadata: { expenseId, amount: expense.amount, category: expense.category },
  })

  return { success: true }
})
