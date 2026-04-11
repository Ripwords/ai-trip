import { authClient } from "../lib/auth-client"

const PROTECTED_ROUTES = new Set(["/dashboard", "/trips", "/explore"])
const GUEST_ONLY_ROUTES = new Set(["/", "/login"])

export default defineNuxtRouteMiddleware(async (to) => {
  const needsAuth = PROTECTED_ROUTES.has(to.path)
  const guestOnly = GUEST_ONLY_ROUTES.has(to.path)

  // Skip session check for routes that don't need it
  if (!needsAuth && !guestOnly) return

  const { data: session } = await authClient.useSession(useFetch)
  const isAuthenticated = !!session.value?.user

  if (!isAuthenticated && needsAuth) {
    return navigateTo("/login")
  }

  if (isAuthenticated && guestOnly) {
    return navigateTo("/dashboard")
  }
})
