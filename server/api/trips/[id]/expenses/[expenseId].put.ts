import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { expenses } from "../../../../db/schema";
import { expenseIdParamsSchema, updateExpenseSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, expenseId } = await getValidatedRouterParams(
    event,
    expenseIdParamsSchema.parse
  );
  const body = await readValidatedBody(event, updateExpenseSchema.parse);

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

  // Verify expense belongs to trip
  const expense = await db.query.expenses.findFirst({
    where: and(eq(expenses.id, expenseId), eq(expenses.tripId, id)),
  });

  if (!expense) {
    throw createError({ statusCode: 404, message: "Expense not found" });
  }

  const { paidAt, ...restBody } = body;
  const [updated] = await db
    .update(expenses)
    .set({
      ...restBody,
      ...(paidAt !== undefined ? { paidAt: paidAt ? new Date(paidAt) : null } : {}),
    })
    .where(eq(expenses.id, expenseId))
    .returning();

  return updated;
});
