// Pure, framework-free descriptions of the OAuth scopes this server issues, so
// the consent screen's wording is unit-testable without a Nuxt runtime.

export interface OAuthScopeDescriptor {
  label: string
  description: string
  /** Scopes that grant mutation or sensitive data. The consent screen marks these. */
  sensitive: boolean
}

/**
 * A registry rather than a chain of conditionals: adding a scope on the server
 * is a one-line addition here, and a scope with no entry still renders safely
 * through `describeScope`'s fallback.
 *
 * `sensitive` is reserved for the two things a person should hesitate over:
 * access that continues while they are not present, and their trip data, which
 * says where they will be and when — and therefore when their home is empty.
 * The identity trio is deliberately unmarked; badging the scopes that appear on
 * every sign-in screen would drown out the ones that matter.
 */
export const OAUTH_SCOPES: Record<string, OAuthScopeDescriptor> = {
  openid: {
    label: "Confirm who you are",
    description: "Shares the account identifier that proves you signed in here.",
    sensitive: false,
  },
  profile: {
    label: "See your basic profile",
    description: "Your name and profile picture. Nothing about your trips.",
    sensitive: false,
  },
  email: {
    label: "See your email address",
    description: "The address on your AI Trip account. It cannot send mail as you.",
    sensitive: false,
  },
  offline_access: {
    label: "Stay connected when you are away",
    description:
      "Keeps access after you close this tab, so it can act on your account while you are not here. Revoke it in Settings.",
    sensitive: true,
  },
  "trips:read": {
    label: "Read your trips",
    description:
      "Your itineraries, destinations and travel dates — including when you will be away from home.",
    sensitive: true,
  },
  "trips:write": {
    label: "Create and change your trips",
    description: "Can add, edit and delete trips, days and stops on your behalf.",
    sensitive: true,
  },
}

/**
 * A client may request any string it likes, and the result is rendered to a
 * person, so an unknown scope must fail closed: show the raw value, admit we
 * cannot explain it, and mark it sensitive rather than implying it is routine.
 */
export function describeScope(scope: string): OAuthScopeDescriptor {
  if (Object.hasOwn(OAUTH_SCOPES, scope)) return OAUTH_SCOPES[scope]!

  const trimmed = scope.trim()
  return {
    label: trimmed || "Unnamed permission",
    description:
      "AI Trip does not recognise this permission, so it cannot say what it grants. Only continue if you trust this app.",
    sensitive: true,
  }
}

/** Splits the space-delimited OAuth `scope` parameter, deduped, order preserved. */
export function parseScopeParam(raw: string | null | undefined): string[] {
  if (!raw) return []
  return [...new Set(raw.split(/\s+/).filter(Boolean))]
}
