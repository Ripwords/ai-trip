import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { expenses } from "../../../../db/schema";
import { expenseIdParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, expenseId } = await getValidatedRouterParams(
    event,
    expenseIdParamsSchema.parse
  );

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

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
