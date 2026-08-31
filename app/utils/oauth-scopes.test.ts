import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { describeScope, OAUTH_SCOPES, parseScopeParam } from "./oauth-scopes"

describe("OAUTH_SCOPES", () => {
  it("covers every scope the auth server is configured to issue", () => {
    for (const scope of [
      "openid",
      "profile",
      "email",
      "offline_access",
      "trips:read",
      "trips:write",
    ]) {
      assert.ok(OAUTH_SCOPES[scope], `${scope} must have a descriptor`)
    }
  })

  it("gives every descriptor a non-empty label and description", () => {
    for (const [scope, descriptor] of Object.entries(OAUTH_SCOPES)) {
      assert.ok(descriptor.label.trim().length > 0, `${scope} label`)
      assert.ok(descriptor.description.trim().length > 0, `${scope} description`)
    }
  })

  it("marks the scopes that grant trip data or absent-user access as sensitive", () => {
    for (const scope of ["offline_access", "trips:read", "trips:write"]) {
      assert.equal(OAUTH_SCOPES[scope]?.sensitive, true, `${scope} must be sensitive`)
    }
  })

  it("leaves the read-only identity baseline unmarked", () => {
    // Marking the scopes present on every sign-in screen would make the badge
    // meaningless on the ones that actually matter.
    for (const scope of ["openid", "profile", "email"]) {
      assert.equal(OAUTH_SCOPES[scope]?.sensitive, false, `${scope} must not be sensitive`)
    }
  })
})

describe("describeScope", () => {
  it("returns the registered descriptor for a known scope", () => {
    assert.deepEqual(describeScope("trips:write"), OAUTH_SCOPES["trips:write"])
  })

  it("never throws, whatever the client asked for", () => {
    for (const scope of ["", "   ", "wat", "a".repeat(5000), "../../etc/passwd", "<script>"]) {
      assert.doesNotThrow(() => describeScope(scope))
    }
  })

  it("treats an unrecognised scope as sensitive", () => {
    // Fail closed: we cannot vouch for a permission we do not know.
    assert.equal(describeScope("billing:charge").sensitive, true)
  })

  it("shows the raw scope rather than inventing a meaning for it", () => {
    const described = describeScope("billing:charge")
    assert.equal(described.label, "billing:charge")
    assert.ok(
      /not recognise|unrecognised/i.test(described.description),
      "description must admit the scope is unknown",
    )
  })

  it("still produces a usable label when the scope is blank", () => {
    const described = describeScope("   ")
    assert.ok(described.label.trim().length > 0)
    assert.equal(described.sensitive, true)
  })

  it("does not let an unknown scope inherit a prototype key", () => {
    // `OAUTH_SCOPES["toString"]` would otherwise resolve to Object.prototype.
    const described = describeScope("toString")
    assert.equal(described.label, "toString")
    assert.equal(described.sensitive, true)
  })
})

describe("parseScopeParam", () => {
  it("splits the space-delimited OAuth scope parameter", () => {
    assert.deepEqual(parseScopeParam("openid profile email"), ["openid", "profile", "email"])
  })

  it("returns an empty list for a missing parameter", () => {
    assert.deepEqual(parseScopeParam(null), [])
    assert.deepEqual(parseScopeParam(undefined), [])
    assert.deepEqual(parseScopeParam(""), [])
    assert.deepEqual(parseScopeParam("     "), [])
  })

  it("tolerates any run of whitespace, including tabs and newlines", () => {
    assert.deepEqual(parseScopeParam("  openid\t\tprofile \n email  "), [
      "openid",
      "profile",
      "email",
    ])
  })

  it("dedupes while preserving first-seen order", () => {
    assert.deepEqual(parseScopeParam("trips:read openid trips:read profile openid"), [
      "trips:read",
      "openid",
      "profile",
    ])
  })
})
