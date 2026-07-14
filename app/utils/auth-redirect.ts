// Pure, framework-free auth-redirect decision logic so it can be unit-tested
// without a Nuxt runtime. The `auth.global.ts` middleware is a thin wrapper
// that fetches the session and defers the routing decision to `resolveAuthRedirect`.

export const PROTECTED_PREFIXES = ["/dashboard", "/trips", "/explore", "/settings"]
export const GUEST_ONLY_ROUTES = new Set(["/"])

export interface AuthRedirectInput {
  /** Path being navigated to (no query string). */
  path: string
  /** Whether the request currently has a valid session. */
  isAuthenticated: boolean
  /** True during SSR / edge rendering, false in the hydrated browser. */
  isServer: boolean
}

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix))
}

export function isGuestOnlyPath(path: string): boolean {
  return GUEST_ONLY_ROUTES.has(path)
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
  const { path, isAuthenticated, isServer } = input
  const needsAuth = isProtectedPath(path)
  const guestOnly = isGuestOnlyPath(path)

  if (!needsAuth && !guestOnly) return null

  if (needsAuth && !isAuthenticated) {
    return "/"
  }

  if (guestOnly && isAuthenticated) {
    // Client-only: a server redirect here would poison the ISR edge cache.
    return isServer ? null : "/dashboard"
  }

  return null
}
