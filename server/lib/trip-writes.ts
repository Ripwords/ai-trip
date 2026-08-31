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
import { getPlaceDetails as defaultGetPlaceDetails } from "./google-maps"
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
    deriveCostFromPlace?: typeof defaultDeriveCostFromPlace
    computeAndSaveSegments?: typeof defaultComputeAndSaveSegments
  } = {},
) {
  const db = deps.db ?? defaultDb
  const requireTripAccess = deps.requireTripAccess ?? defaultRequireTripAccess
  const logTripAction = deps.logTripAction ?? defaultLogTripAction
  const getPlaceDetails = deps.getPlaceDetails ?? defaultGetPlaceDetails
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

  const { itineraryDayId, rating, costEstimate: clientCostEstimate, ...rest } = input

  // Auto-derive a default cost from Google's priceRange when the client
  // didn't provide one and we have a placeId to look up. This is what
  // surfaces in Google Maps as "Around $X" and gives manually-added
  // activities a real starting estimate instead of a silent null.
  let costEstimate: string | null = clientCostEstimate ?? null
  if (!costEstimate && input.placeId) {
    const trip = await db.query.trips.findFirst({ where: eq(trips.id, tripId) })
    if (trip) {
      costEstimate = await deriveCostFromPlace(input.placeId, trip.currencyCode || "USD")
    }
  }

  // Backfill rating / openingHours / priceLevel from Place Details
  // when the client didn't pre-populate them. Text Search no longer
  // returns rating (cost optimization), so this is the single place
  // those fields get attached for manually-added activities.
  let resolvedRating: string | undefined = rating != null ? String(rating) : undefined
  let resolvedOpeningHours: string[] | undefined
  let resolvedPriceLevel: number | undefined
  if (input.placeId) {
    const details = await getPlaceDetails(input.placeId).catch(() => null)
    if (details) {
      if (resolvedRating == null && details.rating != null) {
        resolvedRating = String(details.rating)
      }
      if (details.openingHours) resolvedOpeningHours = details.openingHours
      if (details.priceLevel != null) resolvedPriceLevel = details.priceLevel
    }
  }

  const [activity] = await db
    .insert(activities)
    .values({
      ...rest,
      itineraryDayId,
      sortOrder,
      rating: resolvedRating,
      openingHours: resolvedOpeningHours,
      priceLevel: resolvedPriceLevel,
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
