/**
 * Receipt upload policy — issue #48.
 *
 * Shared so the file picker offers exactly what the server accepts and the
 * size hint in the UI is the real limit. Enforcement lives on the server
 * (server/lib/receipts.ts), which decides the type from the bytes rather than
 * from anything the browser says; these constants only keep the two in step.
 */

/** 5 MB. A phone photo of a receipt is well under this; so is a PDF statement. */
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024

/** Per expense, so one row cannot be used as free object storage. */
export const RECEIPT_MAX_PER_EXPENSE = 5

/**
 * SVG is deliberately absent. It is an image the browser will run scripts
 * inside, and these files are served from our own origin to trip members.
 */
export const RECEIPT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const

export type ReceiptMimeType = (typeof RECEIPT_ALLOWED_MIME_TYPES)[number]

export const RECEIPT_MAX_MB = Math.floor(RECEIPT_MAX_BYTES / (1024 * 1024))
