import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { trips } from "../../db/schema";

const paramsSchema = z.object({
  token: z.string().uuid(),
});

export default defineEventHandler(async (event) => {
  const { token } = await getValidatedRouterParams(event, paramsSchema.parse);

  const trip = await db.query.trips.findFirst({
    where: eq(trips.shareToken, token),
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
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Shared trip not found" });
  }

  // Return trip data without sensitive fields
  return {
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    preferences: trip.preferences,
    currencyCode: trip.currencyCode,
    days: trip.days,
  };
});
