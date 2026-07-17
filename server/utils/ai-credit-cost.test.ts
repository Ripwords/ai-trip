import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { creditsForSteps, MAX_DISCUSS_STEPS, STEPS_PER_CREDIT } from "./ai-credit-cost"

describe("creditsForSteps", () => {
  it("charges a single credit for an ordinary conversational turn", () => {
    // The common case: the agent answers from knowledge with no tool calls, or
    // verifies a couple of venues. This must stay at 1 credit or everyday chat
    // starts feeling metered.
    assert.equal(creditsForSteps(0), 1)
    assert.equal(creditsForSteps(1), 1)
    assert.equal(creditsForSteps(3), 1)
    assert.equal(creditsForSteps(STEPS_PER_CREDIT), 1)
  })

  it("charges a second credit once the turn crosses the first bracket", () => {
    assert.equal(creditsForSteps(STEPS_PER_CREDIT + 1), 2)
    assert.equal(creditsForSteps(STEPS_PER_CREDIT * 2), 2)
  })

  it("charges the Hoi An/Da Nang research turn (10 steps) two credits", () => {
    // Regression anchor for the turn that originally exhausted the budget:
    // 9 searchPlaces + 1 runReview.
    assert.equal(creditsForSteps(10), 2)
  })

  it("scales linearly across brackets", () => {
    assert.equal(creditsForSteps(17), 3)
    assert.equal(creditsForSteps(24), 3)
    assert.equal(creditsForSteps(25), 4)
  })

  it("never exceeds the cost of a full-ceiling run", () => {
    const maxCost = creditsForSteps(MAX_DISCUSS_STEPS)
    assert.equal(maxCost, 4)
    // A run cannot use more steps than the ceiling, so this is the worst case
    // a single prompt can ever bill.
    assert.equal(creditsForSteps(MAX_DISCUSS_STEPS + 5), maxCost)
  })

  it("never returns zero or negative for defensive/garbage input", () => {
    // A wrongly-counted step total must never hand out free or negative credit.
    assert.equal(creditsForSteps(-1), 1)
    assert.equal(creditsForSteps(Number.NaN), 1)
  })
})

describe("step budget constants", () => {
  it("keeps the ceiling within the 300s Vercel function limit at ~1-3s/step", () => {
    // 30 steps * 3s worst case = 90s, comfortably inside the 300s Fluid Compute
    // ceiling. If this ever grows past ~90, revisit: a timeout kills the request
    // mid-flight and the refund in the catch block never runs.
    assert.ok(MAX_DISCUSS_STEPS <= 90)
  })

  it("gives the old 10-step turn room to finish", () => {
    assert.ok(MAX_DISCUSS_STEPS > 10)
  })
})
