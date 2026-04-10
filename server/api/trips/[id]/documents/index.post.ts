import { put } from "@vercel/blob"
import { db } from "../../../../db"
import { documents } from "../../../../db/schema"
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

  const mimeType = fileField.type || "application/octet-stream"
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw createError({ statusCode: 400, message: `File type not allowed: ${mimeType}` })
  }

  if (fileField.data.length > MAX_FILE_SIZE) {
    throw createError({ statusCode: 400, message: "File too large (max 10MB)" })
  }

  // Get optional reservationId from form data
  const reservationIdField = formData.find((f) => f.name === "reservationId")
  const reservationId = reservationIdField?.data?.toString().trim() || undefined

  // Upload to Vercel Blob
  const blob = await put(`trips/${id}/${fileField.filename}`, fileField.data, {
    access: "public",
    contentType: mimeType,
  })

  // Save metadata to DB
  const [doc] = await db
    .insert(documents)
    .values({
      tripId: id,
      reservationId: reservationId || undefined,
      name: fileField.filename,
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
    description: `Uploaded document: ${fileField.filename}`,
  })

  return doc
})
