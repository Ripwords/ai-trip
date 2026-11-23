import { describe, it } from "bun:test"
import assert from "node:assert/strict"
import { isStaleChunkError } from "./chunk-error"

describe("isStaleChunkError", () => {
  it("recognises a missing lazy chunk in every browser's wording", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://example.test/_nuxt/BU5I_Otf.js",
      "error loading dynamically imported module: https://example.test/_nuxt/BU5I_Otf.js",
      "Importing a module script failed.",
      "Unable to preload CSS for /_nuxt/entry.abc.css",
    ]) {
      assert.equal(isStaleChunkError(new Error(message)), true, message)
      assert.equal(isStaleChunkError({ message }), true, message)
    }
  })

  it("leaves ordinary errors alone", () => {
    assert.equal(isStaleChunkError(new Error("Trip not found")), false)
    assert.equal(isStaleChunkError(new Error("Failed to fetch")), false)
    assert.equal(isStaleChunkError(null), false)
    assert.equal(isStaleChunkError("Failed to fetch dynamically imported module"), false)
  })
})
