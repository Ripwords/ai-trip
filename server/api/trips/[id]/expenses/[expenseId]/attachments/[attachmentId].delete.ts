import { and, eq } from "drizzle-orm"
import { db } from "../../../../../../db"
import { expenseAttachments } from "../../../../../../db/schema"
import { expenseAttachmentParamsSchema } from "../../../../../../utils/schemas"
import { purgeAttachmentObjects } from "../../../../../../lib/expense-attachments"

/**
 * Remove a receipt — issue #48.
 *
 * The DELETE is the existence check, matched on all three ids, so a concurrent
 * repeat removes nothing and 404s rather than double-deleting the object.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, expenseId, attachmentId } = await getValidatedRouterParams(
    event,
    expenseAttachmentParamsSchema.parse,
  )

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const [deleted] = await db
    .delete(expenseAttachments)
    .where(
      and(
        eq(expenseAttachments.id, attachmentId),
        eq(expenseAttachments.expenseId, expenseId),
        eq(expenseAttachments.tripId, id),
      ),
    )
    .returning()

  if (!deleted) {
    throw createError({ statusCode: 404, message: "Receipt not found" })
  }

  await purgeAttachmentObjects([deleted.storageKey])

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "expense_receipt_deleted",
    description: `Removed a receipt from an expense: ${deleted.fileName}`,
    metadata: { expenseId, attachmentId },
  })

  return { success: true }
})
