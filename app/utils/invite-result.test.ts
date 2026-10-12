import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { inviteLinkToShare } from "./invite-result"

const members = readFileSync(
  fileURLToPath(new URL("../components/TripMembers.vue", import.meta.url)),
  "utf8",
)

describe("inviteLinkToShare (B16)", () => {
  it("returns nothing when the email went out", () => {
    assert.equal(inviteLinkToShare({ emailSent: true }), null)
    assert.equal(
      inviteLinkToShare({ emailSent: true, inviteUrl: "https://x.test/invite/abc" }),
      null,
    )
  })

  it("returns the link when the email was not sent", () => {
    assert.equal(
      inviteLinkToShare({ emailSent: false, inviteUrl: "https://x.test/invite/abc" }),
      "https://x.test/invite/abc",
    )
  })

  it("returns nothing when there is no link to show", () => {
    assert.equal(inviteLinkToShare({ emailSent: false }), null)
    assert.equal(inviteLinkToShare({ emailSent: false, inviteUrl: "" }), null)
    assert.equal(inviteLinkToShare(undefined), null)
  })
})

describe("TripMembers invite fallback (B16)", () => {
  it("reads the invite response instead of discarding it", () => {
    assert.ok(/inviteLinkToShare\(/.test(members), "the invite result is ignored")
  })

  it("offers a copy button for the fallback link", () => {
    assert.ok(/navigator\.clipboard\.writeText\(/.test(members), "no copy action")
    assert.ok(/Copy invite link/.test(members), "no labelled copy button")
  })

  it("reports failed removals and role changes", () => {
    for (const label of ["Failed to remove member", "Failed to change role"]) {
      const at = members.indexOf(label)
      assert.ok(at > 0, `${label} handler missing`)
      const after = members.slice(at, at + 200)
      assert.ok(/toast\.error\(/.test(after), `${label} only logs`)
    }
  })
})
