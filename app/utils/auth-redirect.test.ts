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
})
