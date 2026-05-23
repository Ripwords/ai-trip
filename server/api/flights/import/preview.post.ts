import { previewImport } from "../../../lib/flight-import"

const MAX_CSV_BYTES = 2 * 1024 * 1024 // 2 MB

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const raw = await readRawBody(event, "utf-8")
  if (!raw) {
    throw createError({ statusCode: 400, statusMessage: "Empty CSV body" })
  }
  if (Buffer.byteLength(raw, "utf-8") > MAX_CSV_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "CSV too large (max 2 MB)" })
  }
  try {
    return await previewImport(raw, session.user.id)
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "FlightyImportError") {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }
})
