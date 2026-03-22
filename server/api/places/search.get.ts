import { placeSearchSchema } from "../../utils/schemas";
import { searchPlace } from "../../lib/google-maps";

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const { query } = await getValidatedQuery(event, placeSearchSchema.parse);

  return searchPlace(query);
});
