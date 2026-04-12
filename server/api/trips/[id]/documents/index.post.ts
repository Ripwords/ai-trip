import { put } from "@vercel/blob"
import { fileTypeFromBuffer } from "file-type"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../db"
import { documents, reservations } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
])

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const formData = await readMultipartFormData(event)
  if (!formData) {
    throw createError({ statusCode: 400, message: "No file uploaded" })
  }

  const fileField = formData.find((f) => f.name === "file")
  if (!fileField || !fileField.data || !fileField.filename) {
    throw createError({ statusCode: 400, message: "No file provided" })
  }

  const safeName = (fileField.filename || "unnamed").replace(/[/\\]/g, "_").slice(0, 255)

  // Magic-byte validation: detect actual file type from buffer
  const detected = await fileTypeFromBuffer(fileField.data)
  const clientMime = fileField.type || "application/octet-stream"

  let mimeType: string
  if (detected) {
    // Binary file: trust the detected type, not the client-supplied one
    if (!ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw createError({ statusCode: 400, message: `File type not allowed: ${detected.mime}` })
    }
    if (detected.mime !== clientMime) {
      throw createError({
        statusCode: 400,
        message: `File type mismatch: declared ${clientMime} but detected ${detected.mime}`,
      })
    }
    mimeType = detected.mime
  } else {
    // Undetectable (plain text files like .txt, .csv) — only allow text-based MIME types
    if (!clientMime.startsWith("text/")) {
      throw createError({
        statusCode: 400,
        message: `File type not allowed: ${clientMime} (could not verify file contents)`,
      })
    }
    if (!ALLOWED_MIME_TYPES.has(clientMime)) {
      throw createError({ statusCode: 400, message: `File type not allowed: ${clientMime}` })
    }
    mimeType = clientMime
  }

  if (fileField.data.length > MAX_FILE_SIZE) {
    throw createError({ statusCode: 400, message: "File too large (max 10MB)" })
  }

  // Get optional reservationId from form data and verify it belongs to this trip
  const reservationIdField = formData.find((f) => f.name === "reservationId")
  const reservationId = reservationIdField?.data?.toString().trim() || undefined

  if (reservationId) {
    const reservation = await db.query.reservations.findFirst({
      where: and(eq(reservations.id, reservationId), eq(reservations.tripId, id)),
      columns: { id: true },
    })
    if (!reservation) {
      throw createError({ statusCode: 400, message: "Reservation not found in this trip" })
    }
  }

  // Upload to Vercel Blob
  const blob = await put(`trips/${id}/${safeName}`, fileField.data, {
    access: "public",
    contentType: mimeType,
  })

  // Save metadata to DB
  const [doc] = await db
    .insert(documents)
    .values({
      tripId: id,
      reservationId: reservationId || undefined,
      name: safeName,
      url: blob.url,
      size: fileField.data.length,
      mimeType,
      uploadedById: session.user.id,
    })
    .returning()

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "document_uploaded",
    description: `Uploaded document: ${safeName}`,
  })

  return doc
})
