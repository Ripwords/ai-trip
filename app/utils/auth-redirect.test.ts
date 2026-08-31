import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveAuthRedirect, resolveSignInTarget, sanitizeReturnPath } from "./auth-redirect"

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

describe("routes that participate in an OAuth authorization", () => {
  const CONSENT_SEARCH =
    "?client_id=abc-123&scope=openid%20trips%3Aread&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&exp=1756600000&sig=Zm9vYmFy-_9w%3D"

  it("never bounces anyone off /sign-in", () => {
    // Not guest-only: bouncing a signed-in user to /dashboard would abandon an
    // in-flight authorization. Not protected: bouncing to / would drop the
    // signed query the page is carrying.
    for (const isAuthenticated of [true, false, "unknown"] as const) {
      for (const isServer of [true, false]) {
        assert.equal(
          resolveAuthRedirect({ path: "/sign-in", isAuthenticated, isServer }),
          null,
          `/sign-in must stay put (isAuthenticated=${isAuthenticated}, isServer=${isServer})`,
        )
        assert.equal(
          resolveAuthRedirect({
            path: "/sign-in",
            search: "?redirect=%2Fdashboard",
            isAuthenticated,
            isServer,
          }),
          null,
        )
      }
    }
  })

  it("leaves a signed-in user on the consent screen", () => {
    for (const isServer of [true, false]) {
      assert.equal(
        resolveAuthRedirect({
          path: "/oauth/consent",
          search: CONSENT_SEARCH,
          isAuthenticated: true,
          isServer,
        }),
        null,
      )
    }
  })

  it("sends a signed-out visitor to /sign-in carrying the whole signed query", () => {
    for (const isServer of [true, false]) {
      const target = resolveAuthRedirect({
        path: "/oauth/consent",
        search: CONSENT_SEARCH,
        isAuthenticated: false,
        isServer,
      })
      assert.ok(target, "expected a /sign-in bounce, got null")
      assert.ok(target.startsWith("/sign-in?"), `expected a /sign-in bounce, got ${target}`)
      const returned = new URLSearchParams(target.slice(target.indexOf("?") + 1)).get("redirect")
      assert.equal(
        returned,
        `/oauth/consent${CONSENT_SEARCH}`,
        "the signed query must survive verbatim, repeated keys included",
      )
    }
  })

  it("tolerates a search string with no leading question mark", () => {
    const target = resolveAuthRedirect({
      path: "/oauth/consent",
      search: CONSENT_SEARCH.slice(1),
      isAuthenticated: false,
      isServer: false,
    })
    assert.ok(target, "expected a /sign-in bounce, got null")
    const returned = new URLSearchParams(target.slice(target.indexOf("?") + 1)).get("redirect")
    assert.equal(returned, `/oauth/consent${CONSENT_SEARCH}`)
  })

  it("still bounces to /sign-in when there is no query at all", () => {
    assert.equal(
      resolveAuthRedirect({ path: "/oauth/consent", isAuthenticated: false, isServer: false }),
      "/sign-in?redirect=%2Foauth%2Fconsent",
    )
  })

  it("does not send a signed-out visitor to the marketing page", () => {
    // The whole point: `/` would silently discard the authorization request.
    const target = resolveAuthRedirect({
      path: "/oauth/consent",
      search: CONSENT_SEARCH,
      isAuthenticated: false,
      isServer: false,
    })
    assert.notEqual(target, "/")
  })

  it("never redirects from the consent screen on an indeterminate session", () => {
    for (const isServer of [true, false]) {
      assert.equal(
        resolveAuthRedirect({
          path: "/oauth/consent",
          search: CONSENT_SEARCH,
          isAuthenticated: "unknown",
          isServer,
        }),
        null,
      )
    }
  })
})

describe("sanitizeReturnPath", () => {
  it("accepts an ordinary in-app path", () => {
    for (const path of ["/dashboard", "/trips/abc", "/oauth/consent?client_id=x&scope=a%20b"]) {
      assert.equal(sanitizeReturnPath(path), path)
    }
  })

  it("preserves a signed OAuth query byte for byte", () => {
    // Stronger than the signature strictly needs, since it canonicalises the
    // decoded pairs, but it is the cheapest way to guarantee duplicates survive.
    const path =
      "/oauth/consent?client_id=abc-123&scope=openid%20profile&redirect_uri=https%3A%2F%2Fc.example%2Fcb&state=xY_z-9%3D%3D&resource=https%3A%2F%2Fa&resource=https%3A%2F%2Fb&sig=Zm9vYmFy-_9w%3D"
    assert.equal(sanitizeReturnPath(path), path)
  })

  it("rejects targets that leave this origin", () => {
    for (const hostile of [
      "//evil.com",
      "//evil.com/path",
      "https://evil.com",
      "http://evil.com",
      "//\\evil.com",
      "\\\\evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      assert.equal(sanitizeReturnPath(hostile), null, `${hostile} must be rejected`)
    }
  })

  it("rejects whitespace and control characters browsers would strip", () => {
    // A stripped tab turns "/\t/evil.com" into the protocol-relative "//evil.com".
    for (const hostile of ["/\t/evil.com", "/\n/evil.com", "/\r//evil.com", "/ /evil.com"]) {
      assert.equal(sanitizeReturnPath(hostile), null, `${JSON.stringify(hostile)} must be rejected`)
    }
  })

  it("rejects a path that normalises into a protocol-relative URL", () => {
    assert.equal(sanitizeReturnPath("/..//evil.com"), null)
  })

  it("rejects anything that is not an absolute in-app path", () => {
    for (const bad of ["dashboard", "", "   ", null, undefined, 42, {}, ["/dashboard"]]) {
      assert.equal(sanitizeReturnPath(bad), null, `${JSON.stringify(bad)} must be rejected`)
    }
  })

  it("accepts the root path", () => {
    assert.equal(sanitizeReturnPath("/"), "/")
  })
})

describe("resolveSignInTarget", () => {
  // better-auth's `loginPage` redirect carries the whole authorization request,
  // HMACed. There is no return-URL param in it; the query IS the return trip.
  const SIGNED_AUTHORIZE_QUERY =
    "client_id=abc-123&scope=openid%20trips%3Aread&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&response_type=code&state=xY_z-9&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&resource=https%3A%2F%2Fa&resource=https%3A%2F%2Fb&exp=1756600000&ba_iat=1756599400000&ba_param=client_id&ba_param=scope&sig=Zm9vYmFy-_9w"

  it("re-enters the authorize endpoint with the signed query untouched", () => {
    // Verified against better-auth 1.7.2: /oauth2/authorize has no query schema
    // and its inner schema is `.passthrough()`, so sig/exp/ba_iat/ba_param ride
    // along harmlessly and the endpoint mints a fresh signature.
    assert.equal(
      resolveSignInTarget(`?${SIGNED_AUTHORIZE_QUERY}`),
      `/api/auth/oauth2/authorize?${SIGNED_AUTHORIZE_QUERY}`,
    )
  })

  it("tolerates a search string with no leading question mark", () => {
    assert.equal(
      resolveSignInTarget(SIGNED_AUTHORIZE_QUERY),
      `/api/auth/oauth2/authorize?${SIGNED_AUTHORIZE_QUERY}`,
    )
  })

  it("prefers the authorization request over a redirect param", () => {
    const target = resolveSignInTarget(`?redirect=%2Fsettings&${SIGNED_AUTHORIZE_QUERY}`)
    assert.ok(target.startsWith("/api/auth/oauth2/authorize?"))
  })

  it("honours a vetted redirect param when there is no authorization request", () => {
    assert.equal(resolveSignInTarget("?redirect=%2Fsettings"), "/settings")
    assert.equal(
      resolveSignInTarget("?redirect=%2Foauth%2Fconsent%3Fclient_id%3Dx%26sig%3Dy"),
      "/oauth/consent?client_id=x&sig=y",
    )
  })

  it("falls back to the dashboard rather than following an off-site redirect", () => {
    for (const hostile of [
      "?redirect=https%3A%2F%2Fevil.com",
      "?redirect=%2F%2Fevil.com",
      "?redirect=%2F%5Cevil.com",
      "?redirect=javascript%3Aalert(1)",
      "?redirect=",
      "?redirect=dashboard",
      "",
      "?",
    ]) {
      assert.equal(resolveSignInTarget(hostile), "/dashboard", `${hostile} must not be followed`)
    }
  })

  it("ignores a partial authorization request that carries no signature", () => {
    // Without `sig` the authorize endpoint would re-derive a fresh request, but
    // a bare client_id in the URL is more likely a hand-edited link than a flow.
    assert.equal(resolveSignInTarget("?client_id=abc-123"), "/dashboard")
  })

  it("refuses to send a signed-in visitor back to the sign-in page", () => {
    for (const selfTarget of [
      "?redirect=%2Fsign-in",
      "?redirect=%2Fsign-in%3Fredirect%3D%252Fsign-in",
    ]) {
      assert.equal(resolveSignInTarget(selfTarget), "/dashboard", `${selfTarget} is a dead end`)
    }
  })
})
