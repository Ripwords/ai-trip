import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { planGenerationRun } from "./generation-plan"

describe("planGenerationRun", () => {
  it("returns mode none when there are no empty days", () => {
    assert.deepEqual(planGenerationRun(0, 10), { mode: "none" })
    assert.deepEqual(planGenerationRun(0, undefined), { mode: "none" })
  })

  it("uses the outline path when remaining credits are unknown", () => {
    const plan = planGenerationRun(4, undefined)
    assert.equal(plan.mode, "outline")
    assert.equal(plan.mode === "outline" && plan.dayCount, 4)
  })

  it("uses the outline path at the boundary remaining === empty + 1", () => {
    const plan = planGenerationRun(4, 5)
    assert.equal(plan.mode, "outline")
    assert.equal(plan.mode === "outline" && plan.dayCount, 4)
    assert.match(
      plan.mode === "outline" ? plan.confirm.message : "",
      /5 AI prompts \(1 to plan the trip, 1 per day\)/,
    )
  })

  it("skips the outline at the boundary remaining === empty", () => {
    const plan = planGenerationRun(4, 4)
    assert.equal(plan.mode, "generic")
    assert.equal(plan.mode === "generic" && plan.dayCount, 4)
  })

  it("caps day count at remaining when credits are scarce", () => {
    const plan = planGenerationRun(6, 2)
    assert.equal(plan.mode, "generic")
    assert.equal(plan.mode === "generic" && plan.dayCount, 2)
    assert.match(plan.mode === "generic" ? plan.confirm.title : "", /Not enough AI prompts/)
  })

  it("attempts exactly one day at zero remaining so the server 429 surfaces", () => {
    const plan = planGenerationRun(3, 0)
    assert.equal(plan.mode, "generic")
    assert.equal(plan.mode === "generic" && plan.dayCount, 1)
  })

  it("pluralizes the outline confirm copy for a single day", () => {
    const plan = planGenerationRun(1, undefined)
    assert.equal(plan.mode, "outline")
    assert.match(plan.mode === "outline" ? plan.confirm.message : "", /1 empty day\b/)
    assert.doesNotMatch(plan.mode === "outline" ? plan.confirm.message : "", /1 empty days/)
  })
})
