import { and, eq, inArray } from "drizzle-orm"
import { db, db as defaultDb } from "../db"
import { tripMembers, trips } from "../db/schema"
import type { TripPreferences } from "../db/schema/trips"
import { resolvePartySize, type ResolvedPartySize } from "./party-size"

type DbHandle = typeof defaultDb

/**
 * Fetch a trip with its full relational payload (days → activities + travelSegments).
 * Returns `undefined` if the trip does not exist. Shape matches `GET /api/trips/[id]`
 * so the client-side `TripResponse` type fits unchanged.
 */
export async function getTripWithRelations(tripId: string) {
  return db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    with: {
      days: {
        orderBy: (days, { asc }) => [asc(days.dayNumber)],
        with: {
          activities: {
            orderBy: (activities, { asc }) => [asc(activities.sortOrder)],
          },
          travelSegments: true,
        },
      },
    },
  })
}

/**
 * How many people are on this trip in the app: the owner plus everyone with an
 * accepted or still-open invite. Always >= 1.
 *
 * The owner has no `trip_members` row — `GET /trips/[id]/members` synthesises
 * that entry — so they are added here rather than counted. `expired` and
 * `removed` rows are excluded: those people are explicitly not on the trip.
 * Pending invites ARE counted, because an invite that hasn't been accepted yet
 * still names someone the traveler intends to bring.
 */
export async function countTripParticipants(
  tripId: string,
  ownerUserId?: string | null,
  deps: { db?: DbHandle } = {},
): Promise<number> {
  const rows = await (deps.db ?? defaultDb)
    .select({ userId: tripMembers.userId, invitedEmail: tripMembers.invitedEmail })
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), inArray(tripMembers.status, ["active", "pending"])))

  // Dedupe by person, not by row. `upsertPendingTripMember` reuses a matching
  // row rather than inserting a second one, but `trip_members` has no unique
  // constraint backing that up, so a legacy or hand-written duplicate would
  // otherwise report a party of 3 for a couple. Preferring the user id keeps a
  // row that carries both identifiers from being counted twice. Rows with
  // neither identifier name nobody and are skipped.
  const seen = new Set<string>()
  for (const r of rows) {
    if (r.userId) {
      if (r.userId === ownerUserId) continue // already counted as the owner
      seen.add(`user:${r.userId}`)
    } else if (r.invitedEmail) {
      seen.add(`email:${r.invitedEmail.trim().toLowerCase()}`)
    }
  }

  return seen.size + 1
}

/**
 * The party size to plan against: the traveler's explicit setting when they
 * gave one, otherwise the trip's member count, otherwise nothing. See
 * server/lib/party-size.ts for why "nothing" is a real answer worth returning.
 *
 * Skips the member query entirely when the setting is present, and degrades to
 * `unknown` rather than throwing — no AI request should fail over a headcount.
 */
export async function loadPartySize(
  trip: {
    id: string
    userId: string
    preferences: TripPreferences | null
  },
  deps: { db?: DbHandle } = {},
): Promise<ResolvedPartySize> {
  const fromSetting = resolvePartySize({ partySize: trip.preferences?.partySize })
  if (fromSetting.size != null) return fromSetting

  try {
    const memberCount = await countTripParticipants(trip.id, trip.userId, deps)
    return resolvePartySize({ memberCount })
  } catch (e: unknown) {
    console.error("[party-size] member count unavailable, proceeding without:", e)
    return { size: null, source: "unknown" }
  }
}
