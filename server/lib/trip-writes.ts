import { and, desc, eq, sql } from "drizzle-orm"
import type { z } from "zod"
import { countryByAlpha2 } from "../../app/data/countries"
import { db as defaultDb } from "../db"
import { activities, itineraryDays, travelSegments, trips } from "../db/schema"
import type { addActivitySchema, createTripSchema } from "../utils/schemas"
import {
  logTripAction as defaultLogTripAction,
  requireTripAccess as defaultRequireTripAccess,
} from "../utils/trip-access"
import { deriveCostFromPlace as defaultDeriveCostFromPlace } from "./cost-from-place"
import { enumerateDates } from "./dates"
import { resolvePlace, type ResolvedPlace } from "./enrich"
import {
  getPlaceDetails as defaultGetPlaceDetails,
  searchPlace as defaultSearchPlace,
} from "./google-maps"
import { computeAndSaveSegments as defaultComputeAndSaveSegments } from "./segments"
import { getTripWithRelations } from "./trips"

type DbHandle = typeof defaultDb

export type CreateTripInput = z.output<typeof createTripSchema>
export type AddActivityInput = z.output<typeof addActivitySchema>

/**
 * The trip-creation policy, shared by `POST /api/trips` and the MCP tool layer.
 * Callers validate `input` against `createTripSchema` before calling; the rules
 * that are not expressible in the schema (a real country, an ordered date range,
 * the per-user cap) live here so no transport can route around them.
 */
export async function createTrip(
  userId: string,
  input: CreateTripInput,
  deps: { db?: DbHandle } = {},
) {
  const db = deps.db ?? defaultDb

  const country = countryByAlpha2.get(input.countryCode)
  if (!country) {
    throw createError({ statusCode: 400, message: "Unknown country" })
  }

  if (input.endDate < input.startDate) {
    throw createError({ statusCode: 400, message: "End date must be on or after start date" })
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(trips)
    .where(eq(trips.userId, userId))
  if (count >= 50) {
    throw createError({ statusCode: 400, message: "Maximum number of trips reached (50)" })
  }

  const name = input.name?.trim() || null
  const [trip] = await db
    .insert(trips)
    .values({
      userId,
      destination: name ?? country.name,
      name,
      countryCode: country.alpha2,
      startDate: input.startDate,
      endDate: input.endDate,
      preferences: input.preferences ?? {},
      currencyCode: input.currencyCode ?? country.currency,
    })
    .returning()

  const dayValues = enumerateDates(input.startDate, input.endDate).map((date, i) => ({
    tripId: trip!.id,
    dayNumber: i + 1,
    date,
  }))

  await db.insert(itineraryDays).values(dayValues)

  // Reads through the module-level handle, not `deps.db`: `getTripWithRelations`
  // is shared with `GET /api/trips/[id]` and takes no injection point.
  return await getTripWithRelations(trip!.id)
}

/**
 * The add-an-activity policy, shared by `POST /api/trips/:id/activities` and the
 * MCP tool layer. The authorization check is inside on purpose: no caller gets
 * to add an activity to a trip it may only read.
 */
export async function addActivity(
  userId: string,
  tripId: string,
  input: AddActivityInput,
  deps: {
    db?: DbHandle
    requireTripAccess?: typeof defaultRequireTripAccess
    logTripAction?: typeof defaultLogTripAction
    getPlaceDetails?: typeof defaultGetPlaceDetails
    searchPlace?: typeof defaultSearchPlace
    deriveCostFromPlace?: typeof defaultDeriveCostFromPlace
    computeAndSaveSegments?: typeof defaultComputeAndSaveSegments
  } = {},
) {
  const db = deps.db ?? defaultDb
  const requireTripAccess = deps.requireTripAccess ?? defaultRequireTripAccess
  const logTripAction = deps.logTripAction ?? defaultLogTripAction
  const getPlaceDetails = deps.getPlaceDetails ?? defaultGetPlaceDetails
  const searchPlace = deps.searchPlace ?? defaultSearchPlace
  const deriveCostFromPlace = deps.deriveCostFromPlace ?? defaultDeriveCostFromPlace
  const computeAndSaveSegments = deps.computeAndSaveSegments ?? defaultComputeAndSaveSegments

  await requireTripAccess(tripId, userId, ["owner", "editor"])

  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, input.itineraryDayId), eq(itineraryDays.tripId, tripId)),
  })

  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" })
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(activities)
    .where(eq(activities.itineraryDayId, input.itineraryDayId))
  if (count >= 30) {
    throw createError({
      statusCode: 400,
      message: "Maximum number of activities per day reached (30)",
    })
  }

  const lastActivity = await db.query.activities.findFirst({
    where: eq(activities.itineraryDayId, input.itineraryDayId),
    orderBy: [desc(activities.sortOrder)],
  })
  const sortOrder = (lastActivity?.sortOrder ?? -1) + 1

  const { itineraryDayId, rating, costEstimate: clientCostEstimate, placeId, ...rest } = input

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, tripId) })

  // A placeId is only a lookup key. Google is the source of truth for where the
  // place is: verify the id via Place Details, fall back to a name search near
  // the day, and refuse the write if neither resolves. Without a placeId this
  // is a free-text note ("Rest at hotel") and is saved with no location.
  let place: ResolvedPlace | null = null
  if (placeId) {
    place = await resolvePlace(
      { name: input.name, placeId },
      {
        destination: trip?.destination ?? "",
        coords:
          day.accommodationLat != null && day.accommodationLng != null
            ? { lat: day.accommodationLat, lng: day.accommodationLng }
            : undefined,
      },
      { getPlaceDetails, searchPlace },
    )
    if (!place) {
      throw createError({ statusCode: 422, message: "Couldn't find this place on Google Maps" })
    }
  }

  // Auto-derive a default cost from Google's priceRange when the client
  // didn't provide one. This is what surfaces in Google Maps as "Around $X"
  // and gives manually-added activities a real starting estimate instead of
  // a silent null.
  let costEstimate: string | null = clientCostEstimate ?? null
  if (!costEstimate && place && trip) {
    costEstimate = await deriveCostFromPlace(place.placeId, trip.currencyCode || "USD")
  }

  // Rating / openingHours / priceLevel come from the same Place Details call
  // that verified the place. Text Search no longer returns rating (cost
  // optimization), so this is where those fields get attached for
  // manually-added activities.
  const resolvedRating =
    rating != null ? String(rating) : place?.rating != null ? String(place.rating) : undefined

  const [activity] = await db
    .insert(activities)
    .values({
      ...rest,
      itineraryDayId,
      sortOrder,
      placeId: place?.placeId ?? null,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
      address: place?.address ?? null,
      rating: resolvedRating,
      openingHours: place?.openingHours.length ? place.openingHours : undefined,
      priceLevel: place?.priceLevel ?? undefined,
      costEstimate,
    })
    .returning()

  await computeAndSaveSegments(itineraryDayId)

  await logTripAction({
    tripId,
    userId,
    action: "activity_added",
    description: `Added "${activity!.name}" to Day`,
  })

  const segments = await db.query.travelSegments.findMany({
    where: eq(travelSegments.itineraryDayId, itineraryDayId),
  })

  return { activity, segments }
}
