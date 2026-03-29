import { z } from "zod";
import { getPlaceDetails } from "../../../lib/google-maps";

const paramsSchema = z.object({
  placeId: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const { placeId } = await getValidatedRouterParams(event, paramsSchema.parse);

  const details = await getPlaceDetails(placeId);
  if (!details) {
    throw createError({ statusCode: 404, message: "Place not found" });
  }

  return details;
});
