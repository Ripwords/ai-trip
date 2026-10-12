import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const source = readFileSync(fileURLToPath(new URL("./LayoverCard.vue", import.meta.url)), "utf8")

describe("LayoverCard AI tips request", () => {
  it("sends an unknown layover length as unknown, never as a made-up 3 hours (B20)", () => {
    assert.doesNotMatch(source, /durationMinutes\s*\?\?\s*\d+/)
    assert.match(source, /durationMinutes: props\.layover\.durationMinutes,/)
  })
})
