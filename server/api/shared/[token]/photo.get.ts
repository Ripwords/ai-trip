import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../db"
import { trips } from "../../../db/schema"
import { getPlacePhoto } from "../../../lib/google-maps"

const paramsSchema = z.object({
  token: z.string().uuid(),
})

const querySchema = z.object({
  placeId: z.string().min(1),
  photo: z.string().min(1),
  maxWidthPx: z.coerce.number().int().min(1).max(1600).default(320),
})

export default defineEventHandler(async (event) => {
  const { token } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { placeId, photo, maxWidthPx } = await getValidatedQuery(event, querySchema.parse)

  if (
    !photo.startsWith(`places/${placeId}/photos/`) ||
    photo.includes("?") ||
    photo.includes("#")
  ) {
    throw createError({ statusCode: 400, message: "Photo does not belong to place" })
  }

  const trip = await db.query.trips.findFirst({
    where: eq(trips.shareToken, token),
    columns: { id: true, shareExpiresAt: true },
    with: {
      days: {
        columns: { id: true },
        with: { activities: { columns: { placeId: true } } },
      },
    },
  })

  if (!trip) {
    throw createError({ statusCode: 404, message: "Shared trip not found" })
  }

  if (trip.shareExpiresAt && trip.shareExpiresAt < new Date()) {
    throw createError({ statusCode: 410, message: "This shared link has expired" })
  }

  const placeBelongsToTrip = trip.days.some((day) =>
    day.activities.some((a) => a.placeId === placeId),
  )
  if (!placeBelongsToTrip) {
    throw createError({ statusCode: 403, message: "Place not part of this shared trip" })
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
