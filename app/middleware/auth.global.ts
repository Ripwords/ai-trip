const PROTECTED_PREFIXES = ["/dashboard", "/trips", "/explore", "/settings"]
const GUEST_ONLY_ROUTES = new Set(["/", "/login"])

export default defineNuxtRouteMiddleware(async (to) => {
  const needsAuth = PROTECTED_PREFIXES.some((r) => to.path.startsWith(r))
  const guestOnly = GUEST_ONLY_ROUTES.has(to.path)

  if (!needsAuth && !guestOnly) return

  // Use $fetch with manually forwarded cookies for SSR compatibility.
  // authClient.useSession(useFetch) doesn't reliably detect sessions
  // on the server during middleware, causing the server to render the
  // wrong layout (landing page instead of dashboard).
  let isAuthenticated = false
  try {
    const headers: Record<string, string> = {}
    if (import.meta.server) {
      const event = useRequestEvent()
      const cookie = event?.node.req.headers.cookie
      if (cookie) headers.cookie = cookie
    }
    const session = await $fetch<{ user?: unknown }>("/api/auth/get-session", {
      headers,
    })
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
