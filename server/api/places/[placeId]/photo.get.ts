import { z } from "zod"
import { getPlacePhoto } from "../../../lib/google-maps"

const paramsSchema = z.object({
  placeId: z.string().min(1),
})

const querySchema = z.object({
  photo: z.string().min(1),
  maxWidthPx: z.coerce.number().int().min(1).max(1600).default(320),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const { placeId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { photo, maxWidthPx } = await getValidatedQuery(event, querySchema.parse)

  if (
    !photo.startsWith(`places/${placeId}/photos/`) ||
    photo.includes("?") ||
    photo.includes("#")
  ) {
    throw createError({ statusCode: 400, message: "Photo does not belong to place" })
  }

  const cached = await getPlacePhoto(photo, maxWidthPx)
  if (!cached) {
    throw createError({ statusCode: 502, message: "Unable to load place photo" })
  }

  const body = Buffer.from(cached.data, "base64")
  const headers = new Headers({
    "content-type": cached.contentType,
    "cache-control": "public, max-age=86400, s-maxage=604800",
  })
  return new Response(body, { headers })
})
