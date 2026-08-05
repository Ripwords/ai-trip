import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveAuthRedirect } from "./auth-redirect"

describe("resolveAuthRedirect", () => {
  it("redirects unauthenticated users away from protected routes to /", () => {
    for (const path of ["/dashboard", "/trips/abc", "/explore", "/settings"]) {
      assert.equal(
        resolveAuthRedirect({ path, isAuthenticated: false, isServer: true }),
        "/",
        `expected ${path} to redirect to / when unauthenticated (server)`,
      )
      assert.equal(
        resolveAuthRedirect({ path, isAuthenticated: false, isServer: false }),
        "/",
        `expected ${path} to redirect to / when unauthenticated (client)`,
      )
    }
  })

  it("leaves authenticated users on protected routes", () => {
    assert.equal(
      resolveAuthRedirect({ path: "/dashboard", isAuthenticated: true, isServer: true }),
      null,
    )
  })

  it("never issues a server-side redirect for the guest-only landing page", () => {
    // This is the ISR-safety guarantee: a server 302 on `/` would be cached at
    // the edge and replayed to everyone, causing the / ↔ /dashboard loop.
    assert.equal(
      resolveAuthRedirect({ path: "/", isAuthenticated: true, isServer: true }),
      null,
      "authenticated user on / must NOT be redirected on the server (ISR cache safety)",
    )
    assert.equal(resolveAuthRedirect({ path: "/", isAuthenticated: false, isServer: true }), null)
  })

  it("redirects authenticated users off the landing page on the client only", () => {
    assert.equal(
      resolveAuthRedirect({ path: "/", isAuthenticated: true, isServer: false }),
      "/dashboard",
    )
  })

  it("leaves unauthenticated users on the landing page", () => {
    assert.equal(resolveAuthRedirect({ path: "/", isAuthenticated: false, isServer: false }), null)
  })

  it("ignores routes that are neither protected nor guest-only", () => {
    assert.equal(
      resolveAuthRedirect({ path: "/invite/xyz", isAuthenticated: false, isServer: true }),
      null,
    )
  })

  // A failed session lookup is NOT proof of a signed-out user. `/api/auth/**`
  // shares one 30-req/min rate-limit bucket per IP, so a burst of ordinary
  // navigation returns 429 for a perfectly valid session. Treating that as
  // "unauthenticated" bounced signed-in users to the marketing page.
  describe("when the session state cannot be determined", () => {
    it("never redirects away from a protected route", () => {
      for (const path of ["/dashboard", "/trips/abc", "/explore", "/settings"]) {
        for (const isServer of [true, false]) {
          assert.equal(
            resolveAuthRedirect({ path, isAuthenticated: "unknown", isServer }),
            null,
            `${path} (isServer=${isServer}) must not bounce on an indeterminate session`,
          )
        }
      }
    })

    it("never redirects away from the landing page either", () => {
      assert.equal(
        resolveAuthRedirect({ path: "/", isAuthenticated: "unknown", isServer: false }),
        null,
      )
      assert.equal(
        resolveAuthRedirect({ path: "/", isAuthenticated: "unknown", isServer: true }),
        null,
      )
    })

    it("still redirects on a definitive negative", () => {
      // Guards against "fix" that simply stops redirecting altogether.
      assert.equal(
        resolveAuthRedirect({ path: "/dashboard", isAuthenticated: false, isServer: false }),
        "/",
      )
    })
  })
})
