import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { humanMessage } from "./human-message"

describe("humanMessage", () => {
  it("passes a real sentence through untouched", () => {
    assert.equal(
      humanMessage("This invite has already been used."),
      "This invite has already been used.",
    )
  })

  it("suppresses the stringified Zod issue array the invite page was showing", () => {
    const zodDump = JSON.stringify([
      { origin: "string", code: "invalid_format", format: "uuid", path: ["token"] },
    ])
    const shown = humanMessage(zodDump)
    assert.notEqual(shown, zodDump)
    assert.ok(!shown.includes("origin"))
    assert.ok(!shown.includes("invalid_format"))
  })

  it("suppresses object-shaped and multi-line payloads", () => {
    assert.equal(humanMessage('{"code":"BAD"}'), "Something went wrong. Please try again.")
    assert.equal(humanMessage("line one\nline two"), "Something went wrong. Please try again.")
  })

  it("suppresses prose that still smuggles issue keys", () => {
    assert.equal(
      humanMessage('Validation failed "code": "invalid_format"'),
      "Something went wrong. Please try again.",
    )
  })

  it("falls back for empty, blank and missing input", () => {
    for (const input of [undefined, null, "", "   "]) {
      assert.equal(humanMessage(input), "Something went wrong. Please try again.")
    }
  })

  it("suppresses very long dumps", () => {
    assert.equal(humanMessage("x".repeat(400)), "Something went wrong. Please try again.")
  })

  it("honours a caller-supplied fallback", () => {
    assert.equal(
      humanMessage(undefined, "Couldn't accept the invite."),
      "Couldn't accept the invite.",
    )
  })
})
