import "zod/compile"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { z } from "zod"
import { friendlyParamError } from "./friendly-error"

describe("friendlyParamError", () => {
  const schema = z.object({ token: z.string().uuid() })

  it("replaces a Zod issue array with the supplied human message", () => {
    const result = schema.safeParse({ token: "not-a-uuid" })
    assert.equal(result.success, false)
    const err = friendlyParamError(
      result.success ? null : result.error,
      "That link doesn't look right.",
    )

    assert.equal(err.statusCode, 400)
    assert.equal(err.message, "That link doesn't look right.")
  })

  it("never leaks Zod's internal issue shape into the message", () => {
    const result = schema.safeParse({ token: "nope" })
    const err = friendlyParamError(result.success ? null : result.error, "Invalid link.")

    // These are the substrings that showed up verbatim on the invite page.
    for (const leak of ["origin", "code", "invalid_format", "expected", "[", "{"]) {
      assert.ok(
        !err.message.includes(leak),
        `message must not contain ${JSON.stringify(leak)} — got ${err.message}`,
      )
    }
  })

  it("marks the error so Nitro does not attach the original as data", () => {
    const result = schema.safeParse({ token: "nope" })
    const err = friendlyParamError(result.success ? null : result.error, "Invalid link.")
    assert.equal(err.data, undefined)
    assert.equal(err.statusMessage, "Bad Request")
  })
})
