/** The tags a card has room for, and how many it leaves out (shown as "+N"). */
export function visibleTags(
  tags: readonly string[] | null | undefined,
  max = 2,
): { shown: string[]; hidden: number } {
  const all = tags ?? []
  return { shown: all.slice(0, max), hidden: Math.max(all.length - max, 0) }
}
