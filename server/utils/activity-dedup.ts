/**
 * Same-day duplicate guard for AI-suggested activities: adding a place the day
 * already has is never intended — match by placeId when both sides have one,
 * else by exact normalized name.
 *
 * Deliberately NOT substring matching. The generation handlers used
 * `existing.includes(name) || name.includes(existing)`, which silently dropped
 * any suggestion whose name was a substring of an existing one, or vice versa
 * ("Bar Trench" behind "Sushi Bar", "Ueno Park" behind "Ueno Park Zoo").
 *
 * Lives in utils/ rather than lib/proposals.ts so lib/ai.ts can use it without
 * pulling the database into its module graph.
 */
export function filterDuplicateActivities<T extends { name: string; placeId?: string | null }>(
  incoming: T[],
  existing: { name: string; placeId?: string | null }[],
): { fresh: T[]; duplicates: T[] } {
  const names = new Set(existing.map((a) => a.name.toLowerCase().trim()))
  const placeIds = new Set(existing.map((a) => a.placeId).filter((p): p is string => !!p))
  const fresh: T[] = []
  const duplicates: T[] = []
  for (const a of incoming) {
    const isDuplicate =
      (a.placeId != null && placeIds.has(a.placeId)) || names.has(a.name.toLowerCase().trim())
    if (isDuplicate) duplicates.push(a)
    else fresh.push(a)
  }
  return { fresh, duplicates }
}
