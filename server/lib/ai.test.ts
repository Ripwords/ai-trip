import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SCHEDULE_RULES } from "./ai"

describe("SCHEDULE_RULES", () => {
  it("contains a dedicated ROUTE LOGIC step that runs before times/order are chosen", () => {
    assert.match(SCHEDULE_RULES, /ROUTE LOGIC/)
    assert.match(SCHEDULE_RULES, /BEFORE picking times or order/i)
  })

  it("anchors the day on explicit start and end points", () => {
    assert.match(SCHEDULE_RULES, /anchors/i)
  })

  it("demands one continuous path with no doubling back", () => {
    assert.match(SCHEDULE_RULES, /continuous path/i)
    assert.match(SCHEDULE_RULES, /double back/i)
  })

  it("puts en-route stops on the day that actually travels that leg", () => {
    assert.match(SCHEDULE_RULES, /on the way between/i)
    assert.match(SCHEDULE_RULES, /round trip/i)
  })
})
