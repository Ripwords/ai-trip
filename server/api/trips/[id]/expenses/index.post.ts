import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { activities, expenses, tripMembers, trips } from "../../../../db/schema";
import { uuidParamsSchema, createExpenseSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);
  const body = await readValidatedBody(event, createExpenseSchema.parse);

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

  // If activityId provided, verify activity belongs to this trip
  if (body.activityId) {
    const activity = await db.query.activities.findFirst({
      where: eq(activities.id, body.activityId),
      with: {
        day: true,
      },
    });

    if (!activity || activity.day.tripId !== id) {
      throw createError({ statusCode: 404, message: "Activity not found" });
    }
  }

  // If paidById provided, verify they are owner or active member of this trip
  if (body.paidById) {
    const trip = await db.query.trips.findFirst({ where: eq(trips.id, id), columns: { userId: true } });
    if (!trip) throw createError({ statusCode: 404, message: "Trip not found" });

    const isOwner = body.paidById === trip.userId;
    if (!isOwner) {
      const member = await db.query.tripMembers.findFirst({
        where: (m, { and, eq: e }) => and(e(m.tripId, id), e(m.userId, body.paidById!), e(m.status, "active")),
      });
      if (!member) {
        throw createError({ statusCode: 400, message: "Paid-by user is not a member of this trip" });
      }
    }
  }

  const { paidAt, ...restBody } = body;
  const [expense] = await db
    .insert(expenses)
    .values({
      ...restBody,
      tripId: id,
      paidAt: paidAt ? new Date(paidAt) : undefined,
    })
    .returning();

  // Audit log
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "expense_added",
    description: `Added expense: ${body.description} ($${body.amount})`,
  });

  return expense;
});
