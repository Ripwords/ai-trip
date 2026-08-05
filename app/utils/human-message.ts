const FALLBACK = "Something went wrong. Please try again."

/**
 * Guards against showing a machine-shaped error string to a person.
 *
 * A server that validates router params with `schema.parse` throws a raw
 * ZodError; Nitro puts the stringified issue array in the response message, and
 * a page that renders it verbatim shows the user:
 *
 *   [ { "origin": "string", "code": "invalid_format", "expected": "uuid", ... } ]
 *
 * Server handlers should send a sentence in the first place (see
 * `server/utils/friendly-error.ts`) — this is the last line of defence for the
 * ~75 endpoints that still validate params directly.
 */
export function humanMessage(raw: string | undefined | null, fallback = FALLBACK): string {
  if (!raw) return fallback

  const text = raw.trim()
  if (!text) return fallback

  // JSON-ish, or a stack/log line rather than prose.
  if (/^[[{]/.test(text)) return fallback
  if (/"(code|origin|expected|received|path|issues)"\s*:/.test(text)) return fallback
  if (text.includes("\n")) return fallback
  // Absurdly long strings are dumps, not messages.
  if (text.length > 200) return fallback

  return text
}
