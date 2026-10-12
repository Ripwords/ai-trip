export interface DayRestorePlan<T> {
  /** Activities still on the day: rewritten in place, keeping their id. */
  updates: { id: string; values: T }[]
  /** Activities the snapshot holds that are no longer on the day. */
  inserts: T[]
  /** Activities on the day that the snapshot does not hold. */
  deleteIds: string[]
}

/**
 * Turn an undo snapshot into the smallest set of writes that restores it.
 *
 * Restore used to delete every activity on the day and insert the snapshot,
 * which gave every activity a new id — so comments, votes and participants
 * cascaded away and linked expenses were unlinked, even on activities the AI
 * never touched (audit B7). An activity whose id is still on the day is now
 * updated in place; only the ones the AI removed are re-inserted (new ids —
 * their dependants are already gone), and only the ones it added are deleted.
 *
 * A snapshot without ids (an older client) degrades to the old replace.
 */
export function planDayRestore<T extends { id?: string }>(
  existingIds: readonly string[],
  snapshot: readonly T[],
): DayRestorePlan<Omit<T, "id">> {
  const onDay = new Set(existingIds)
  const kept = new Set<string>()
  const updates: { id: string; values: Omit<T, "id"> }[] = []
  const inserts: Omit<T, "id">[] = []

  for (const { id, ...values } of snapshot) {
    if (id && onDay.has(id) && !kept.has(id)) {
      kept.add(id)
      updates.push({ id, values })
    } else {
      inserts.push(values)
    }
  }

  return { updates, inserts, deleteIds: existingIds.filter((id) => !kept.has(id)) }
}
