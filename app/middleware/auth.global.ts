const PROTECTED_PREFIXES = ["/dashboard", "/trips", "/explore", "/settings"]
const GUEST_ONLY_ROUTES = new Set(["/", "/login"])

export default defineNuxtRouteMiddleware(async (to) => {
  const needsAuth = PROTECTED_PREFIXES.some((r) => to.path.startsWith(r))
  const guestOnly = GUEST_ONLY_ROUTES.has(to.path)

  if (!needsAuth && !guestOnly) return

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

  if (!isAuthenticated && needsAuth) {
    return navigateTo("/login")
  }

  if (isAuthenticated && guestOnly) {
    return navigateTo("/dashboard")
  }
})
