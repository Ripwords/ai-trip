import { and, eq } from "drizzle-orm"
import { db } from "../../../../db"
import { expenses } from "../../../../db/schema"
import { expenseIdParamsSchema } from "../../../../utils/schemas"
import { releaseExpenseSlot } from "../../../../lib/expense-cap"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, expenseId } = await getValidatedRouterParams(event, expenseIdParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // The delete is the existence check. Reading the row first and then deleting
  // it unconditionally was a read-then-write race: two requests for the same
  // expense both saw it, both deleted (the second removing nothing), and both
  // gave a slot back — so the counter fell below the real row count and the
  // 200-row cap the insert path was just made atomic against became a lie.
  //
  // `DELETE ... RETURNING` inside the transaction is atomic: exactly one caller
  // gets a row, and only that caller releases a slot.
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.tripId, id)))
      .returning()

    // Nothing removed: either it never existed, it belongs to another trip, or
    // a concurrent request already deleted it. None of those owe a slot back.
    if (!row) return null

    await releaseExpenseSlot(id, tx)
    return row
  })

  if (!deleted) {
    throw createError({ statusCode: 404, message: "Expense not found" })
  }

  // Expenses drive settlement — i.e. who owes whom real money — so a
  // collaborator deleting someone else's row must leave a trace. Only POST
  // used to log.
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "expense_deleted",
    description: `Deleted expense: ${deleted.description}`,
    metadata: { expenseId, amount: deleted.amount, category: deleted.category },
  })

  return { success: true }
})
