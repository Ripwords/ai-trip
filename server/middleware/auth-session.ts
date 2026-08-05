import { auth } from "../lib/auth"

declare module "h3" {
  interface H3EventContext {
    /**
     * Session resolved once per request, or `null` when there is definitively
     * none. Absent entirely when this middleware chose not to resolve it (API
     * and asset requests), which callers must treat as "unknown".
     */
    authSession?: Awaited<ReturnType<typeof auth.api.getSession>> | null
  }
}

// Paths that never need a pre-resolved session on the context:
//  - /api/**   every handler already calls requireAuth(event) itself, and
//              better-auth's own routes resolve the session internally.
//  - assets    _nuxt, _ipx, favicons, source maps and friends.
const SKIP = /^\/(api|_nuxt|_ipx|_vercel|__nuxt|favicon|apple-touch-icon|sw\.js|manifest)/

/**
 * Resolves the session for document requests via better-auth's server API — a
 * direct function call, exactly as the Nuxt integration guide recommends for
 * server code.
 *
 * This replaces a `$fetch("/api/auth/get-session")` that the global route
 * middleware used to make on every protected navigation. That round-trip went
 * through the whole Nitro pipeline including the rate limiter, so ordinary
 * browsing produced 429s that were misread as "signed out". Calling the API
 * directly costs one cookie-cache decrypt (or one DB read when that cache has
 * expired), makes no HTTP request, and cannot be rate limited.
 */
export default defineEventHandler(async (event) => {
  if (event.method !== "GET" || SKIP.test(event.path)) return

  try {
    event.context.authSession = await auth.api.getSession({ headers: event.headers })
  } catch (error) {
    // Leave `authSession` undefined so the route middleware reads it as
    // "unknown" and declines to redirect, rather than signing the user out
    // because the database blinked.
    console.warn("[auth] session resolution failed", {
      path: event.path,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
