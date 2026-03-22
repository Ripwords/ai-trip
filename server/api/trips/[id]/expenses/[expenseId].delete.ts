import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { trips, expenses } from "../../../../db/schema";
import { expenseIdParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, expenseId } = await getValidatedRouterParams(
    event,
    expenseIdParamsSchema.parse
  );

  // Verify trip belongs to user
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  // Verify expense belongs to trip
  const expense = await db.query.expenses.findFirst({
    where: and(eq(expenses.id, expenseId), eq(expenses.tripId, id)),
  });

  if (!expense) {
    throw createError({ statusCode: 404, message: "Expense not found" });
  }

  await db.delete(expenses).where(eq(expenses.id, expenseId));

  return { success: true };
});
