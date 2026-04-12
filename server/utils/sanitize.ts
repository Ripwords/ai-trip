const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(previous|above|prior)/i,
  /you\s+are\s+now/i,
  /developer\s+mode/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /act\s+as\s+(if\s+)?(you\s+are|a)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /forget\s+(everything|all|your)/i,
  /new\s+instructions/i,
  /override\s+(instructions|rules|system)/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /do\s+anything\s+now/i,
  /bypass\s+(filter|safety|restriction)/i,
  /system\s*:\s*you\s+are/i,
]

const MAX_INPUT_LENGTH = 5000

/**
 * Sanitize user input before passing to LLM.
 * Returns sanitized string or null if input is rejected.
 */
export function sanitizePromptInput(input: string): string | null {
  if (!input || input.length > MAX_INPUT_LENGTH) {
    return null
  }

  // Strip control characters, normalize whitespace
  const cleaned = input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim()

  if (!cleaned) return null

  // Check for injection patterns
  if (INJECTION_PATTERNS.some((p) => p.test(cleaned))) {
    return null
  }

  // Check for encoded injection attempts (base64)
  const base64Matches = cleaned.match(/[A-Za-z0-9+/]{30,}={0,2}/g)
  if (base64Matches) {
    for (const match of base64Matches) {
      try {
        const decoded = atob(match)
        if (INJECTION_PATTERNS.some((p) => p.test(decoded))) {
          return null
        }
      } catch {
        // Not valid base64
      }
    }
  }

  return cleaned
}
