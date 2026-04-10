import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { userProfiles } from "../../db/schema";

const bodySchema = z.object({
  nationality: z.string().length(2).toUpperCase().nullable(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const body = await readValidatedBody(event, bodySchema.parse);

  const existing = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, session.user.id),
  });

  if (existing) {
    const [updated] = await db
      .update(userProfiles)
      .set({ nationality: body.nationality })
      .where(eq(userProfiles.userId, session.user.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(userProfiles)
    .values({
      userId: session.user.id,
      nationality: body.nationality,
    })
    .returning();

  return created;
});
