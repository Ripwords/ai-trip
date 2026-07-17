/**
 * Turns a trip-outline day entry into the prompt string sent to the day-AI
 * endpoint. Pure and client-side: the outline is never persisted, it only
 * travels from `/generate-outline` into each `days/[dayId]/ai` call.
 */

export interface OutlineDayEntry {
  dayId: string
  dayNumber: number
  theme: string
  focusArea: string
  mustInclude: string[]
  guidance: string
}

/**
 * The day-AI body schema caps `prompt` at 2000 chars; stay under it with room
 * to spare. `sanitizePromptInput` collapses whitespace server-side, so the
 * prompt is emitted as a single plain line.
 */
export const MAX_DAY_PROMPT_CHARS = 1900

/** Collapse to the same shape `sanitizePromptInput` would produce. */
function flatten(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

function compose(
  theme: string,
  focusArea: string,
  guidance: string,
  mustInclude: string[],
  avoid: string[],
): string {
  const parts: string[] = [`Plan this day as: ${theme}.`]
  if (focusArea) parts.push(`Concentrate around ${focusArea}.`)
  if (guidance) parts.push(guidance)
  if (mustInclude.length > 0) {
    parts.push(`Include if they are real places there: ${mustInclude.join(", ")}.`)
  }
  if (avoid.length > 0) {
    parts.push(`Do NOT include: ${avoid.join(", ")}.`)
  }
  return parts.join(" ")
}

export function buildDayPromptFromOutline(entry: OutlineDayEntry, avoidRepeats: string[]): string {
  const theme = flatten(entry.theme)
  const focusArea = flatten(entry.focusArea)
  const guidance = flatten(entry.guidance)
  const mustInclude = entry.mustInclude.map(flatten).filter(Boolean)
  const avoid = avoidRepeats.map(flatten).filter(Boolean)

  // Drop whole avoid entries (never mid-name) until it fits.
  for (let i = avoid.length; i >= 0; i--) {
    const candidate = compose(theme, focusArea, guidance, mustInclude, avoid.slice(0, i))
    if (candidate.length <= MAX_DAY_PROMPT_CHARS) return candidate
  }

  // Still too long: drop must-includes next.
  for (let i = mustInclude.length; i >= 0; i--) {
    const candidate = compose(theme, focusArea, guidance, mustInclude.slice(0, i), [])
    if (candidate.length <= MAX_DAY_PROMPT_CHARS) return candidate
  }

  // Pathological theme/guidance — hard-slice as a last resort.
  return compose(theme, focusArea, guidance, [], []).slice(0, MAX_DAY_PROMPT_CHARS).trim()
}
