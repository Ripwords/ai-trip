import { and, count, eq } from "drizzle-orm"
import { db } from "../../../../../../db"
import { expenseAttachments } from "../../../../../../db/schema"
import { expenseIdParamsSchema } from "../../../../../../utils/schemas"
import {
  requireExpenseOnTrip,
  toAttachmentSummary,
} from "../../../../../../lib/expense-attachments"
import { getReceiptStorage, receiptStorageKey } from "../../../../../../lib/receipt-storage"
import {
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_MB,
  RECEIPT_MAX_PER_EXPENSE,
  validateReceiptUpload,
} from "../../../../../../lib/receipts"

/** Multipart framing around a single part: boundary, headers, trailer. */
const MULTIPART_OVERHEAD_BYTES = 8 * 1024

/**
 * Attach a receipt to an expense — issue #48.
 *
 * Uploading is an edit of the trip's finances, so it needs the same role adding
 * the expense did: viewers can look at receipts, they cannot post them.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, expenseId } = await getValidatedRouterParams(event, expenseIdParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Refuse an oversized body from its declared length, before it is buffered.
  // `validateReceiptUpload` enforces the real limit on the real bytes; this is
  // only so a 500 MB post is not read into memory to be told it is too big.
  const declaredLength = Number(getRequestHeader(event, "content-length") ?? 0)
  if (declaredLength > RECEIPT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw createError({
      statusCode: 413,
      message: `Receipts must be ${RECEIPT_MAX_MB} MB or smaller`,
    })
  }

  await requireExpenseOnTrip(id, expenseId)

  const parts = await readMultipartFormData(event)
  const file = parts?.find((part) => part.name === "file" && part.filename)
  if (!file) {
    throw createError({ statusCode: 400, message: "No file was uploaded" })
  }

  const bytes = new Uint8Array(file.data)
  const validated = validateReceiptUpload({
    fileName: file.filename ?? "receipt",
    declaredType: file.type,
    bytes,
  })

  // Not atomic, unlike the expense cap — two simultaneous uploads can both see
  // room for one. The overshoot is bounded by the number of concurrent requests
  // and costs a few megabytes, which is not worth a row lock on the expense.
  const [existing] = await db
    .select({ total: count() })
    .from(expenseAttachments)
    .where(eq(expenseAttachments.expenseId, expenseId))

  if (Number(existing?.total ?? 0) >= RECEIPT_MAX_PER_EXPENSE) {
    throw createError({
      statusCode: 400,
      message: `An expense can have at most ${RECEIPT_MAX_PER_EXPENSE} receipts`,
    })
  }

  const storage = getReceiptStorage()
  const storageKey = receiptStorageKey(id, expenseId)
  await storage.put(storageKey, bytes, validated.mimeType)

  let row
  try {
    ;[row] = await db
      .insert(expenseAttachments)
      .values({
        expenseId,
        tripId: id,
        storageKey,
        fileName: validated.fileName,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        uploadedById: session.user.id,
      })
      .returning()
  } catch (error: unknown) {
    // The object is written before the row, so a failed insert would otherwise
    // leave bytes nothing will ever reference or delete.
    await storage.delete([storageKey]).catch(() => {})
    throw error
  }

  if (!row) {
    await storage.delete([storageKey]).catch(() => {})
    throw createError({ statusCode: 500, message: "Could not save that receipt" })
  }

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "expense_receipt_added",
    description: `Attached a receipt to an expense: ${validated.fileName}`,
    metadata: {
      expenseId,
      attachmentId: row.id,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
    },
  })

  return toAttachmentSummary(row)
})
