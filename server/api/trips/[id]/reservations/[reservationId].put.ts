import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { reservations } from "../../../../db/schema";
import { reservationIdParamsSchema, updateReservationSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, reservationId } = await getValidatedRouterParams(
    event,
    reservationIdParamsSchema.parse
  );
  const body = await readValidatedBody(event, updateReservationSchema.parse);

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.tripId, id)),
  });

  if (!reservation) {
    throw createError({ statusCode: 404, message: "Reservation not found" });
  }

  const { startDate, endDate, ...restBody } = body;
  const [updated] = await db
    .update(reservations)
    .set({
      ...restBody,
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
    })
    .where(eq(reservations.id, reservationId))
    .returning();

  return updated;
});
