import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { activities, expenses } from "../../../../db/schema";
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

  const [expense] = await db
    .insert(expenses)
    .values({ ...body, tripId: id })
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
