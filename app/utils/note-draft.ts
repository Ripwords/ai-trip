/** Blank text means "no note"; anything else is kept exactly as typed. */
export function normalizeNote(text: string | null | undefined): string | null {
  if (text == null) return null
  return text.trim() === "" ? null : text
}

/**
 * Whether a blur should save. Saving an unchanged draft is not harmless: a
 * textarea still showing an older note would write that note back over a newer
 * one saved from elsewhere.
 */
export function noteChanged(saved: string | null | undefined, draft: string): boolean {
  return normalizeNote(saved) !== normalizeNote(draft)
}
