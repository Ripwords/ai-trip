import type { AuthState } from "../utils/auth-redirect"
import { isGuestOnlyPath, isProtectedPath, resolveAuthRedirect } from "../utils/auth-redirect"

/**
 * Server-side: the session was already resolved by `server/middleware/auth-session.ts`
 * using better-auth's `auth.api.getSession({ headers })` — the call the Nuxt
 * integration guide recommends for server code. Reading it off the request
 * context costs nothing and, crucially, makes no HTTP request, so it can never
 * be rate limited into a false "signed out".
 *
 * We cannot call `auth.api.getSession` from here directly: this file is app
 * code that also ships to the browser, and importing `server/lib/auth` would
 * pull the database client and BETTER_AUTH_SECRET into the client bundle.
 */
function authStateFromRequest(): AuthState {
  const event = useRequestEvent()
  if (!event) return "unknown"
  // The key is set (possibly to null) only when the server middleware actually
  // ran and completed. Absent means it skipped or threw — not a signed-out user.
  if (!("authSession" in event.context)) return "unknown"
  return !!event.context.authSession?.user
}

/**
 * Client-side: resolved once per app load and cached for the rest of the
 * session, so route changes cost zero requests. Deliberately NOT seeded from
 * the SSR payload: `/` is ISR-cached (nuxt.config routeRules), and serialising
 * one visitor's session into a shared edge-cached payload would leak it to
 * everyone who lands on the marketing page.
 *
 * Staleness is bounded and safe: sign-out navigates externally (full reload,
 * cache gone), and a session that expires mid-visit surfaces as a 401 from the
 * API rather than as a wrong redirect.
 */
async function authStateFromClient(): Promise<AuthState> {
  const cached = useState<AuthState | undefined>("auth:state", () => undefined)
  if (cached.value !== undefined) return cached.value

  try {
    const session = await $fetch<{ user?: unknown }>("/api/auth/get-session")
    cached.value = !!session?.user
  } catch (error) {
    const status =
      (error as { status?: number })?.status ?? (error as { statusCode?: number })?.statusCode
    // Only the server explicitly saying "no session" is definitive. A 429 from
    // the shared /api/auth/** rate-limit bucket, a 5xx, or an offline browser
    // must not sign anyone out. Left uncached so the next navigation retries.
    if (status === 401 || status === 403) cached.value = false
    else return "unknown"
  }
  return cached.value
}

export default defineNuxtRouteMiddleware(async (to) => {
  // Sign-out redirect carries ?logout=1 — skip the auth check so we don't
  // race BetterAuth's cookie clearing and bounce back to /dashboard via the
  // cookieCache (5-min JWE TTL). Without this guard, just-signed-out users
  // can land in a /-↔-/dashboard redirect loop while the cache lingers.
  if (to.query.logout === "1") return

  const needsAuth = isProtectedPath(to.path)
  const guestOnly = isGuestOnlyPath(to.path)

  if (!needsAuth && !guestOnly) return

  // `/` is served from a shared ISR edge cache (see nuxt.config routeRules).
  // Never touch the session or redirect for a guest-only route on the server:
  // a server 302 would be captured by the edge cache and replayed to every
  // visitor, sending unauthenticated users into a /-↔-/dashboard loop. The
  // guest-only → /dashboard redirect happens on the client after hydration.
  if (guestOnly && import.meta.server) return

  const isAuthenticated = import.meta.server ? authStateFromRequest() : await authStateFromClient()

  const target = resolveAuthRedirect({
    path: to.path,
    isAuthenticated,
    isServer: import.meta.server,
  })

  if (!target) return

  // Never navigate while Vue is still hydrating: the router would swap routes
  // before mount, making Vue hydrate the target page's vnodes against the
  // current page's server-rendered DOM. Dev builds detect and repair the
  // mismatches ("Hydration completed but contains mismatches"); production
  // builds skip that recovery and leave a corrupted, half-rendered page
  // (landing hero grafted into the dashboard, blank content). Defer the
  // redirect until hydration has finished instead.
  const nuxtApp = useNuxtApp()
  if (import.meta.client && nuxtApp.isHydrating) {
    nuxtApp.hooks.hookOnce("app:suspense:resolve", () => {
      navigateTo(target)
    })
    return
  }

  return navigateTo(target)
})
