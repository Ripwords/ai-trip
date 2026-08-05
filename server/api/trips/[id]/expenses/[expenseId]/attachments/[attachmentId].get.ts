import { and, eq } from "drizzle-orm"
import { db } from "../../../../../../db"
import { expenseAttachments } from "../../../../../../db/schema"
import { expenseAttachmentParamsSchema } from "../../../../../../utils/schemas"
import { getReceiptStorage } from "../../../../../../lib/receipt-storage"

/**
 * The receipt itself — issue #48.
 *
 * This is the endpoint a leak would come from, so the row is looked up by all
 * three ids at once: the attachment must belong to that expense, on that trip,
 * and the caller must already be a member of that trip. Knowing an attachment
 * id is worth nothing on its own.
 *
 * Note what is *not* here: `server/api/shared/[token].get.ts` returns no
 * finances at all, and receipts are not added to it. A public share link is
 * forwardable, and a receipt carries card digits, addresses and names.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, expenseId, attachmentId } = await getValidatedRouterParams(
    event,
    expenseAttachmentParamsSchema.parse,
  )

  // Viewers may read; this is not an edit.
  await requireTripAccess(id, session.user.id)

  const row = await db.query.expenseAttachments.findFirst({
    where: and(
      eq(expenseAttachments.id, attachmentId),
      eq(expenseAttachments.expenseId, expenseId),
      eq(expenseAttachments.tripId, id),
    ),
  })

  if (!row) {
    throw createError({ statusCode: 404, message: "Receipt not found" })
  }

  const object = await getReceiptStorage().get(row.storageKey)
  if (!object) {
    console.error("[receipts] row has no object behind it", row.id)
    throw createError({ statusCode: 404, message: "Receipt not found" })
  }

  // A PDF renders in-browser with a scripting engine attached; an image does
  // not. Images are shown inline, PDFs are downloaded, and the sandbox header
  // means neither can do anything with our origin if the type is ever wrong.
  const disposition = row.mimeType.startsWith("image/") ? "inline" : "attachment"

  setResponseHeaders(event, {
    "Content-Type": row.mimeType,
    "Content-Length": String(object.body.byteLength),
    "Content-Disposition": `${disposition}; filename="${row.fileName}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    // Private: a shared cache must never hold another member's receipt.
    "Cache-Control": "private, max-age=300, must-revalidate",
  })

  return Buffer.from(object.body)
})
