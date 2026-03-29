import { z } from "zod";

const querySchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
});

const _getRate = defineCachedFunction(
  async (_event: unknown, from: string, to: string): Promise<number> => {
    const response = await $fetch<{ rate: number }>(
      `https://api.frankfurter.dev/v2/rate/${from}/${to}`
    );
    return response.rate;
  },
  {
    maxAge: 60 * 60 * 6, // 6 hours — exchange rates don't change that fast
    name: "exchangeRate",
    getKey: (_event: unknown, from: string, to: string) => `${from}-${to}`,
  }
);

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const { from, to } = await getValidatedQuery(event, querySchema.parse);

  if (from === to) return { rate: 1 };

  const rate = await _getRate(null, from, to);
  return { rate };
});
