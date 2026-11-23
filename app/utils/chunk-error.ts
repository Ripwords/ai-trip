// Each browser words a missing lazy chunk differently: Chrome, Firefox, Safari,
// then Vite's own message for a lazy stylesheet.
const STALE_CHUNK_MESSAGES = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
  "Unable to preload CSS",
]

/**
 * True when an error means the tab is running a build that has since been
 * replaced: the script it asked for was deleted by a newer deploy.
 */
export function isStaleChunkError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("message" in error)) return false
  const { message } = error
  return typeof message === "string" && STALE_CHUNK_MESSAGES.some((m) => message.includes(m))
}
