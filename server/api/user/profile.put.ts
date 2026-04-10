import { z } from "zod";
import { db } from "../../db";
import { userProfiles } from "../../db/schema";

const bodySchema = z.object({
  nationality: z.string().length(2).toUpperCase().nullable(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const body = await readValidatedBody(event, bodySchema.parse);

  const [result] = await db
    .insert(userProfiles)
    .values({
      userId: session.user.id,
      nationality: body.nationality,
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { nationality: body.nationality },
    })
    .returning();

  return result;
});
