/** A discuss toolset with `readDay` present only when a day is open. */
export type ScopedDiscussTools<T extends { readDay: unknown }> = Omit<T, "readDay"> &
  Partial<Pick<T, "readDay">>

/**
 * Trim the discuss toolset to what the turn's scope can actually serve.
 *
 * `readDay` reads `ctx.activeDayId`. A trip-level discuss has no open day, so
 * offering it meant a call ran `WHERE id = ''` against a uuid column, threw,
 * and the user still paid for the metered step (audit B22). Every other tool
 * either takes its own day id or handles the empty scope without a query.
 */
export function scopeDiscussTools<T extends { readDay: unknown }>(
  tools: T,
  activeDayId: string | null,
): ScopedDiscussTools<T> {
  if (activeDayId) return tools
  const { readDay: _omitted, ...rest } = tools
  return rest
}
