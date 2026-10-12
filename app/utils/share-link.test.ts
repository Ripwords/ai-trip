import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { isShareActive } from "./share-link"

const page = readFileSync(
  fileURLToPath(new URL("../pages/trips/[id].vue", import.meta.url)),
  "utf8",
)

const now = new Date("2026-10-12T12:00:00Z")

describe("isShareActive (B17)", () => {
  it("is off without a token", () => {
    assert.equal(isShareActive(null, null, now), false)
    assert.equal(isShareActive(null, "2026-11-01T00:00:00Z", now), false)
  })

  it("is on for a token that has not expired", () => {
    assert.equal(isShareActive("t", "2026-11-01T00:00:00Z", now), true)
  })

  it("is off once the expiry has passed", () => {
    assert.equal(isShareActive("t", "2026-10-01T00:00:00Z", now), false)
    assert.equal(isShareActive("t", "2026-10-12T12:00:00Z", now), false)
  })

  it("treats a token with no expiry as on", () => {
    assert.equal(isShareActive("t", null, now), true)
    assert.equal(isShareActive("t", undefined, now), true)
  })

  it("treats an unreadable expiry as expired", () => {
    assert.equal(isShareActive("t", "not a date", now), false)
  })
})

describe("trip page share control (B17)", () => {
  it("decides shared or not from the expiry as well as the token", () => {
    assert.ok(/isShareActive\(/.test(page), "page ignores the share expiry")
    assert.ok(!/v-if="!trip\.shareToken"/.test(page), "share button still keys off the raw token")
  })

  it("tells the owner when the link expires", () => {
    assert.ok(/Link expires/.test(page), "share menu does not show the expiry")
  })
})
