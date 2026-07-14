import { isGuestOnlyPath, isProtectedPath, resolveAuthRedirect } from "../utils/auth-redirect"

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

  // useRequestFetch returns a $fetch that auto-forwards cookies/headers
  // during SSR — unlike authClient.useSession(useFetch) which fails to
  // detect sessions on the server during middleware.
  let isAuthenticated = false
  try {
    const fetchWithCookies = useRequestFetch()
    const session = await fetchWithCookies<{ user?: unknown }>("/api/auth/get-session")
    isAuthenticated = !!session?.user
  } catch {
    // Session fetch failed — treat as unauthenticated
  }

  const target = resolveAuthRedirect({
    path: to.path,
    isAuthenticated,
    isServer: import.meta.server,
  })

  if (target) return navigateTo(target)
})
