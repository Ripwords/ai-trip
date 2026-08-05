import { and, asc, eq } from "drizzle-orm"
import { db } from "../../../../../../db"
import { expenseAttachments } from "../../../../../../db/schema"
import { expenseIdParamsSchema } from "../../../../../../utils/schemas"
import {
  requireExpenseOnTrip,
  toAttachmentSummary,
} from "../../../../../../lib/expense-attachments"

/**
 * A receipt list for one expense — issue #48.
 *
 * Readable by any member including viewers: seeing the artefact behind a number
 * is the point of the feature. The `where` names the trip as well as the
 * expense, so a valid expense id from another trip returns nothing rather than
 * that trip's receipts.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, expenseId } = await getValidatedRouterParams(event, expenseIdParamsSchema.parse)

  await requireTripAccess(id, session.user.id)
  await requireExpenseOnTrip(id, expenseId)

  const rows = await db.query.expenseAttachments.findMany({
    where: and(eq(expenseAttachments.tripId, id), eq(expenseAttachments.expenseId, expenseId)),
    orderBy: [asc(expenseAttachments.createdAt)],
  })

  return rows.map(toAttachmentSummary)
})
