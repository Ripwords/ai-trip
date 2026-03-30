import { and, eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { db } from "../../../../db";
import { documents } from "../../../../db/schema";
import { documentIdParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, documentId } = await getValidatedRouterParams(
    event,
    documentIdParamsSchema.parse
  );

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

  const doc = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.tripId, id)),
  });

  if (!doc) {
    throw createError({ statusCode: 404, message: "Document not found" });
  }

  // Delete from Vercel Blob
  try {
    await del(doc.url);
  } catch (e) {
    console.error("Failed to delete blob:", e);
    // Continue with DB deletion even if blob deletion fails
  }

  await db.delete(documents).where(eq(documents.id, documentId));

  return { success: true };
});
