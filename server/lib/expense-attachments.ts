import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "../db"
import { expenseAttachments, expenses } from "../db/schema"
import { getReceiptStorage } from "./receipt-storage"

/**
 * Shared pieces of the receipt endpoints — issue #48.
 *
 * The rule every one of them obeys: an attachment is addressed by
 * (trip, expense, attachment) together, never by its own id alone. A row that
 * does not match all three is a 404, so guessing an attachment id from another
 * trip tells the caller nothing.
 */

export interface ExpenseAttachmentSummary {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadedById: string | null
  createdAt: Date
  /** Where to fetch the bytes. Membership is re-checked on that request. */
  url: string
}

interface AttachmentRow {
  id: string
  tripId: string
  expenseId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadedById: string | null
  createdAt: Date
}

/** Never includes `storageKey`: the client has no use for it and it is the one
 *  field that would matter if the store were ever made public. */
export function toAttachmentSummary(row: AttachmentRow): ExpenseAttachmentSummary {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt,
    url: `/api/trips/${row.tripId}/expenses/${row.expenseId}/attachments/${row.id}`,
  }
}

/** The expense, if it is on this trip. 404 otherwise — the caller has already
 *  been proven a member of `tripId`, so this is about the expense, not access. */
export async function requireExpenseOnTrip(tripId: string, expenseId: string): Promise<void> {
  const expense = await db.query.expenses.findFirst({
    where: and(eq(expenses.id, expenseId), eq(expenses.tripId, tripId)),
    columns: { id: true },
  })
  if (!expense) {
    throw createError({ statusCode: 404, message: "Expense not found" })
  }
}

/**
 * Drop the objects behind a set of attachment rows.
 *
 * Called *after* the rows are gone, so the failure mode is an orphaned object
 * rather than a row pointing at nothing. Storage that a real object store would
 * not cascade is not cascaded here either.
 */
export async function purgeAttachmentObjects(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return
  try {
    await getReceiptStorage().delete(storageKeys)
  } catch (error: unknown) {
    console.error("[receipts] could not remove stored objects", storageKeys.length, error)
  }
}

/**
 * Receipts for a page of expenses, keyed by expense id.
 *
 * One query for the page rather than one per row: the alternative is fifty
 * requests from the browser to render fifty thumbnails. An empty page short
 * circuits, because `inArray(…, [])` is not a query worth sending.
 */
export async function attachmentsByExpense(
  tripId: string,
  expenseIds: string[],
): Promise<Map<string, ExpenseAttachmentSummary[]>> {
  const grouped = new Map<string, ExpenseAttachmentSummary[]>()
  if (expenseIds.length === 0) return grouped

  const rows = await db.query.expenseAttachments.findMany({
    where: and(
      eq(expenseAttachments.tripId, tripId),
      inArray(expenseAttachments.expenseId, expenseIds),
    ),
    orderBy: [asc(expenseAttachments.createdAt)],
  })

  for (const row of rows) {
    const bucket = grouped.get(row.expenseId)
    if (bucket) bucket.push(toAttachmentSummary(row))
    else grouped.set(row.expenseId, [toAttachmentSummary(row)])
  }
  return grouped
}

/** Storage keys for every receipt on a trip, for the trip-deletion sweep. */
export async function storageKeysForTrip(tripId: string): Promise<string[]> {
  const rows = await db.query.expenseAttachments.findMany({
    where: eq(expenseAttachments.tripId, tripId),
    columns: { storageKey: true },
  })
  return rows.map((row) => row.storageKey)
}

/** Storage keys for every receipt on one expense, for the expense-deletion sweep. */
export async function storageKeysForExpense(tripId: string, expenseId: string): Promise<string[]> {
  const rows = await db.query.expenseAttachments.findMany({
    where: and(eq(expenseAttachments.tripId, tripId), eq(expenseAttachments.expenseId, expenseId)),
    columns: { storageKey: true },
  })
  return rows.map((row) => row.storageKey)
}
