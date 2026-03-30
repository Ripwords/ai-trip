import { eq, or } from "drizzle-orm";
import { db } from "../../db";
import { packingTemplates } from "../../db/schema";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);

  return db.query.packingTemplates.findMany({
    where: or(
      eq(packingTemplates.isGlobal, true),
      eq(packingTemplates.userId, session.user.id)
    ),
    orderBy: (t, { desc }) => [desc(t.isGlobal), desc(t.createdAt)],
  });
});
