import { eq } from "drizzle-orm";
import { db } from "../../db";
import { userProfiles } from "../../db/schema";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);

  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
  });

  return profile ?? { userId: session.user.id, nationality: null };
});
