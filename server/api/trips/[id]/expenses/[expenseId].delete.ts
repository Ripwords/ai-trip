import { and, eq } from "drizzle-orm"
import { db } from "../../../../db"
import { expenses } from "../../../../db/schema"
import { expenseIdParamsSchema } from "../../../../utils/schemas"
import { releaseExpenseSlot } from "../../../../lib/expense-cap"
import { purgeAttachmentObjects, storageKeysForExpense } from "../../../../lib/expense-attachments"

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
  // Read the receipt keys before the delete: `expense_attachments` cascades
  // with the expense, and an object store does not cascade at all, so the keys
  // have to be in hand before the rows go (#48).
  const storageKeys = await storageKeysForExpense(id, expenseId)

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

  // After the rows are gone, so a storage failure orphans an object rather
  // than leaving a row pointing at nothing.
  await purgeAttachmentObjects(storageKeys)

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
