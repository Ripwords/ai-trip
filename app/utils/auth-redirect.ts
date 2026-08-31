// Pure, framework-free auth-redirect decision logic so it can be unit-tested
// without a Nuxt runtime. The `auth.global.ts` middleware is a thin wrapper
// that fetches the session and defers the routing decision to `resolveAuthRedirect`.

export const SIGN_IN_ROUTE = "/sign-in"
export const RETURN_TO_PARAM = "redirect"
export const SIGNED_IN_HOME = "/dashboard"
export const AUTHORIZE_ENDPOINT = "/api/auth/oauth2/authorize"

/** Where a signed-out visitor to a protected route gets sent. */
export type SignedOutDestination =
  /** The marketing page. The requested URL is discarded. */
  | "landing"
  /** `/sign-in`, carrying the requested URL so the flow resumes after Google. */
  | "sign-in-and-return"

/**
 * A table rather than a list plus a special case, because "protected" is really
 * two policies. Most routes can afford to drop the URL on the floor and land
 * the visitor on the marketing page. `/oauth/consent` cannot: its query string
 * is a signed authorization request with a bounded lifetime, and losing it
 * strands the OAuth client with no way back.
 *
 * `/sign-in` is deliberately in neither this table nor `GUEST_ONLY_ROUTES`.
 * Protecting it would bounce arrivals to `/` and drop the return URL; making it
 * guest-only would bounce an already-signed-in user to `/dashboard` and abandon
 * an authorization that was only passing through.
 */
export const PROTECTED_PREFIXES: Readonly<Record<string, SignedOutDestination>> = {
  "/dashboard": "landing",
  "/trips": "landing",
  "/explore": "landing",
  "/settings": "landing",
  "/oauth/consent": "sign-in-and-return",
}

export const GUEST_ONLY_ROUTES = new Set(["/"])

/**
 * Tri-state on purpose. `"unknown"` means the session lookup itself failed
 * (network error, 429 from the shared `/api/auth/**` rate-limit bucket, a 5xx)
 * — which is NOT the same as "this user is signed out". Collapsing the two is
 * what bounced signed-in users to the marketing page.
 */
export type AuthState = boolean | "unknown"

export interface AuthRedirectInput {
  /** Path being navigated to (no query string). */
  path: string
  /**
   * Raw query string for `path`, leading `?` optional. Only routes whose
   * signed-out destination is `"sign-in-and-return"` read it, and they carry it
   * back verbatim so repeated keys survive. See `resolveSignInTarget` for what
   * the authorization signature does and does not cover.
   */
  search?: string
  /** `true` signed in, `false` definitively signed out, `"unknown"` undetermined. */
  isAuthenticated: AuthState
  /** True during SSR / edge rendering, false in the hydrated browser. */
  isServer: boolean
}

export function isProtectedPath(path: string): boolean {
  return signedOutDestination(path) !== null
}

export function signedOutDestination(path: string): SignedOutDestination | null {
  for (const [prefix, destination] of Object.entries(PROTECTED_PREFIXES)) {
    if (path.startsWith(prefix)) return destination
  }
  return null
}

export function isGuestOnlyPath(path: string): boolean {
  return GUEST_ONLY_ROUTES.has(path)
}

// Backslashes, spaces and control characters are all silently stripped or
// re-read by URL parsers, which turns "/<TAB>/evil.com" into the
// protocol-relative "//evil.com". Nothing legitimate here contains them.
const UNSAFE_IN_RETURN_PATH = /[\u0000-\u0020\u007f\\]/
const SAME_ORIGIN_BASE = "http://return-path.invalid"

/**
 * Vets a caller-supplied navigation target. Returns the normalised path, or
 * `null` if it could send the visitor anywhere but this origin.
 *
 * Guards an open redirect: the value ends up as the post-OAuth `callbackURL`,
 * so an unconstrained one would let any link hand a freshly authenticated user
 * to an attacker. Only same-origin relative targets pass.
 */
export function sanitizeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  if (UNSAFE_IN_RETURN_PATH.test(raw)) return null

  let normalized: string
  try {
    const url = new URL(raw, SAME_ORIGIN_BASE)
    if (url.origin !== SAME_ORIGIN_BASE) return null
    normalized = `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }

  // "/..//evil.com" parses as same-origin but normalises to "//evil.com".
  if (!normalized.startsWith("/") || normalized.startsWith("//")) return null
  return normalized
}

/**
 * Where a completed sign-in should land, given `/sign-in`'s own raw query
 * string. Two callers put a visitor on that page and they look different.
 *
 * better-auth's `loginPage` redirect carries the whole authorization request,
 * HMACed, with no return-URL param — the query itself is the return trip. The
 * way back in is to re-enter `/oauth2/authorize` with it. That endpoint declares
 * no query schema and validates against a `.passthrough()` object, so `sig`,
 * `exp` and the `ba_*` bookkeeping params ride along inertly and it mints a
 * fresh signature (verified against better-auth 1.7.2). Re-entering also buys a
 * fresh 600s lifetime, which a slow trip through Google can otherwise outlast,
 * and lets an already-consented user skip the consent screen entirely.
 *
 * Everything else arrives from `signInCarrying` with a plain `redirect` param.
 *
 * Pass the raw string, not a rebuilt one. `canonicalizeOAuthQueryParams` sorts
 * the decoded pairs and re-serialises them through `URLSearchParams`, so the
 * signature covers the key/value multiset alone. Percent-encoding and parameter
 * order are not covered, but repeated `resource` and `ba_param` entries are, and
 * flattening the query into a plain object drops those duplicates and fails
 * verification.
 */
export function resolveSignInTarget(search: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search
  const params = new URLSearchParams(raw)

  if (params.get("sig") && params.get("client_id")) {
    return sanitizeReturnPath(`${AUTHORIZE_ENDPOINT}?${raw}`) ?? SIGNED_IN_HOME
  }

  const returnTo = sanitizeReturnPath(params.get(RETURN_TO_PARAM))
  if (!returnTo) return SIGNED_IN_HOME

  // A crafted `?redirect=/sign-in` would land a freshly signed-in visitor back
  // on this page with nothing to do. Same-origin, so not an open redirect, but
  // still a dead end a link can put someone in.
  return returnTo === SIGN_IN_ROUTE || returnTo.startsWith(`${SIGN_IN_ROUTE}?`)
    ? SIGNED_IN_HOME
    : returnTo
}

function signInCarrying(path: string, search: string | undefined): string {
  const query = !search ? "" : search.startsWith("?") ? search : `?${search}`
  const returnTo = sanitizeReturnPath(`${path}${query}`)
  if (!returnTo) return SIGN_IN_ROUTE
  return `${SIGN_IN_ROUTE}?${new URLSearchParams({ [RETURN_TO_PARAM]: returnTo }).toString()}`
}

/**
 * Decide where (if anywhere) to redirect. Returns a path to `navigateTo`, or
 * `null` to stay put.
 *
 * The critical rule: guest-only routes (currently just `/`) must NEVER issue a
 * server-side redirect. `/` is served from a shared ISR edge cache (see
 * `nuxt.config.ts` routeRules), so a server 302 → /dashboard would be cached
 * and replayed to EVERY visitor — including unauthenticated ones, who then get
 * bounced back to `/` by the protected-route guard, producing an infinite
 * `/ ↔ /dashboard` redirect loop. Authenticated visitors are redirected to the
 * dashboard on the client instead, after hydration.
 */
export function resolveAuthRedirect(input: AuthRedirectInput): string | null {
  const { path, search, isAuthenticated, isServer } = input
  const destination = signedOutDestination(path)
  const guestOnly = isGuestOnlyPath(path)

  if (!destination && !guestOnly) return null

  // Undetermined session: stay put in both directions. Failing open is correct
  // here because this middleware is a UX affordance, not a security boundary —
  // every protected API handler independently calls `requireAuth(event)`, which
  // 401s on a real absence of session. The worst case is a signed-out visitor
  // briefly seeing an app shell whose data requests then fail; the alternative
  // (the old behaviour) was silently signing out legitimate users.
  if (isAuthenticated === "unknown") return null

  if (destination && !isAuthenticated) {
    return destination === "sign-in-and-return" ? signInCarrying(path, search) : "/"
  }

  if (guestOnly && isAuthenticated) {
    // Client-only: a server redirect here would poison the ISR edge cache.
    return isServer ? null : "/dashboard"
  }

  return null
}
