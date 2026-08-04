/**
 * Patterns that indicate an attempt to override the model's instructions.
 *
 * Deliberately anchored on the *addressee* ("you", "your instructions") rather
 * than on bare verbs. The looser earlier versions fired on ordinary travel
 * prose — "the old town can act as a base", "we are now thinking of Osaka",
 * "forget everything you know about Naples pizza" — and each false positive
 * rejected the whole request with "contains disallowed content".
 *
 * See sanitize.test.ts for the corpus of legitimate text that must keep passing.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+|any\s+)?(the\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(everything|all)\s+(you|your|above|previous|prior)/i,
  /forget\s+your\s+(instructions?|rules?|prompt|training)/i,
  /(?:^|[.!?]\s+|\b)you\s+are\s+now\s+(a|an|the|my|no longer)\b/i,
  /developer\s+mode/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /(?:^|[.!?]\s+)?\b(act|behave|respond)\s+as\s+(if\s+you\s+(are|were)|an?\s+(unrestricted|unfiltered|uncensored|evil|jailbroken))/i,
  /pretend\s+(that\s+)?you\s+(are|were|have)/i,
  /(new|updated|revised)\s+(system\s+)?instructions\s*:/i,
  /(ignore|override|bypass)\s+(your\s+)?(previous\s+)?(instructions|rules|system\s*prompt|guidelines)/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /do\s+anything\s+now/i,
  /bypass\s+(the\s+)?(filter|safety|restriction|guardrail)/i,
  /system\s*:\s*you\s+are/i,
]

/**
 * Input longer than this is TRUNCATED, not rejected.
 *
 * Returning null used to mean buildTripNotesCtx substituted "", silently
 * dropping the traveler's stated constraints from every prompt with no warning
 * in the UI and no log line. A truncated note keeps most of the signal.
 */
const MAX_INPUT_LENGTH = 5000

/**
 * Detection-only injection check. Runs the pattern + base64 scan WITHOUT the
 * whitespace-collapsing transform, so it is safe to run over assistant markdown
 * (which must survive verbatim). Returns true if the text looks like an attempt
 * to override instructions.
 */
export function detectInjection(text: string): boolean {
  if (!text) return false
  if (INJECTION_PATTERNS.some((p) => p.test(text))) return true
  const base64Matches = text.match(/[A-Za-z0-9+/]{30,}={0,2}/g)
  if (base64Matches) {
    for (const match of base64Matches) {
      try {
        const decoded = atob(match)
        if (INJECTION_PATTERNS.some((p) => p.test(decoded))) return true
      } catch {
        /* not valid base64 */
      }
    }
  }
  return false
}

/**
 * Sanitize user input before passing to LLM.
 * Returns sanitized string or null if input is rejected.
 */
export function sanitizePromptInput(input: string): string | null {
  if (!input) return null

  // Strip control characters, then normalize whitespace WITHOUT flattening
  // newlines: trip notes carry real structure (per-day sections, bullet lists)
  // that a blanket /\s+/ -> " " destroyed before the model ever saw it. Runs of
  // spaces collapse; blank-line runs collapse to a single paragraph break.
  const cleaned = input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  if (!cleaned) return null

  // Check the FULL text before truncating — otherwise an injection could be
  // hidden past the cutoff and survive by being sliced off the inspected copy.
  if (detectInjection(cleaned)) {
    return null
  }

  return cleaned.length > MAX_INPUT_LENGTH ? cleaned.slice(0, MAX_INPUT_LENGTH).trim() : cleaned
}
