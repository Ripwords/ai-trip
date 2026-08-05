/**
 * What counts as a receipt — issue #48.
 *
 * Kept free of h3 and of the database so the policy can be tested directly on
 * hostile input, which is what all three of these arguments are: the filename,
 * the declared content type and the bytes are supplied by whoever posts the
 * form.
 */

import {
  RECEIPT_ALLOWED_MIME_TYPES,
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_MB,
  type ReceiptMimeType,
} from "../../shared/utils/receipts"

// The policy numbers live in shared/ so the file picker and the size hint in
// the UI cannot drift from what this file enforces. Re-exported because every
// server-side caller wants the limits and the validator together.
export {
  RECEIPT_ALLOWED_MIME_TYPES,
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_MB,
  RECEIPT_MAX_PER_EXPENSE,
  type ReceiptMimeType,
} from "../../shared/utils/receipts"

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0))
}

/**
 * The content type implied by the bytes themselves, or `null` for anything not
 * on the allow-list.
 *
 * The `Content-Type` of a multipart part is a claim by the uploader; it decides
 * nothing here. A file is what its leading bytes say it is or it is refused.
 */
export function sniffReceiptMimeType(bytes: Uint8Array): ReceiptMimeType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  // SOI + the first marker byte. Two bytes alone would match far too much.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf"
  // RIFF is a container: .wav and .avi share the first four bytes, so the
  // form type at offset 8 is the part that actually identifies WebP.
  if (startsWith(bytes, ascii("RIFF")) && bytes.byteLength >= 12) {
    const formType = String.fromCharCode(...bytes.slice(8, 12))
    if (formType === "WEBP") return "image/webp"
  }
  return null
}

const MAX_FILE_NAME_LENGTH = 120

/**
 * A filename safe to store and to echo back in a `Content-Disposition` header.
 * Path components are dropped rather than escaped — there is no legitimate
 * reason for a receipt to name a directory.
 */
export function sanitiseReceiptFileName(raw: string): string {
  const basename = raw.split(/[/\\]/).pop() ?? ""
  // Control characters and quotes both let a filename forge extra header
  // lines when it is echoed into `Content-Disposition`.
  const cleaned = basename.replace(/[\u0000-\u001f\u007f"]/g, "").trim()
  if (!cleaned) return "receipt"
  if (cleaned.length <= MAX_FILE_NAME_LENGTH) return cleaned

  // Keep the extension: it is what tells the user what they are downloading.
  const dot = cleaned.lastIndexOf(".")
  const extension = dot > 0 ? cleaned.slice(dot, dot + 10) : ""
  return cleaned.slice(0, MAX_FILE_NAME_LENGTH - extension.length) + extension
}

export interface ReceiptUpload {
  fileName: string
  declaredType: string | undefined
  bytes: Uint8Array
}

export interface ValidatedReceipt {
  fileName: string
  mimeType: ReceiptMimeType
  sizeBytes: number
}

/**
 * Accept or refuse one uploaded file. Throws an h3 error, so route handlers can
 * call it and let the thrown status reach the client unchanged.
 */
export function validateReceiptUpload(upload: ReceiptUpload): ValidatedReceipt {
  const { bytes } = upload

  if (bytes.byteLength === 0) {
    throw createError({ statusCode: 400, message: "That file is empty" })
  }

  if (bytes.byteLength > RECEIPT_MAX_BYTES) {
    throw createError({
      statusCode: 413,
      message: `Receipts must be ${RECEIPT_MAX_MB} MB or smaller`,
    })
  }

  const sniffed = sniffReceiptMimeType(bytes)
  if (!sniffed) {
    throw createError({
      statusCode: 400,
      message: "Receipts must be a JPEG, PNG, WebP or PDF",
    })
  }

  // A file whose bytes and label disagree is either mislabelled or an attempt
  // to have it served back under a type it is not. Neither is worth accepting.
  if (upload.declaredType && upload.declaredType.split(";")[0]?.trim() !== sniffed) {
    throw createError({
      statusCode: 400,
      message: "That file's contents do not match its type",
    })
  }

  return {
    fileName: sanitiseReceiptFileName(upload.fileName),
    mimeType: sniffed,
    sizeBytes: bytes.byteLength,
  }
}
