import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  chargedSoFar,
  creditsForSteps,
  discussStepCeiling,
  MAX_DISCUSS_STEPS,
  MAX_DISCUSS_STEPS_THINKING,
  shouldStripTools,
  STEPS_PER_CREDIT,
  stepCostNote,
  THINKING_CREDIT_MULTIPLIER,
  TURN_TIME_BUDGET_MS,
} from "./ai-credit-cost"

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

describe("creditsForSteps with an explicit ceiling", () => {
  it("defaults to the normal ceiling when none is given", () => {
    // Every existing caller passes one argument. Their behaviour must not move.
    assert.equal(creditsForSteps(MAX_DISCUSS_STEPS + 5), creditsForSteps(MAX_DISCUSS_STEPS))
  })

  it("bills a thinking turn against the thinking ceiling, not the normal one", () => {
    // The bug this parameter exists to prevent: creditsForSteps used to clamp at
    // MAX_DISCUSS_STEPS internally, so a 40-step thinking turn silently billed as 30.
    const at40 = creditsForSteps(40, MAX_DISCUSS_STEPS_THINKING)
    assert.equal(at40, 5)
    assert.ok(at40 > creditsForSteps(40), "the thinking ceiling must bill more than the normal one")
  })

  it("still clamps at whatever ceiling it was given", () => {
    assert.equal(
      creditsForSteps(MAX_DISCUSS_STEPS_THINKING + 10, MAX_DISCUSS_STEPS_THINKING),
      creditsForSteps(MAX_DISCUSS_STEPS_THINKING, MAX_DISCUSS_STEPS_THINKING),
    )
  })

  it("never returns zero or negative for garbage input, ceiling or not", () => {
    assert.equal(creditsForSteps(-1, MAX_DISCUSS_STEPS_THINKING), 1)
    assert.equal(creditsForSteps(Number.NaN, MAX_DISCUSS_STEPS_THINKING), 1)
  })
})

describe("discussStepCeiling", () => {
  it("returns the normal ceiling in normal mode", () => {
    assert.equal(discussStepCeiling(false), MAX_DISCUSS_STEPS)
  })

  it("returns the raised ceiling in thinking mode", () => {
    assert.equal(discussStepCeiling(true), MAX_DISCUSS_STEPS_THINKING)
  })
})

describe("THINKING_CREDIT_MULTIPLIER", () => {
  it("is a whole number greater than one", () => {
    // Fractional multipliers would let a turn bill a fraction of a credit, which
    // the integer promptCount column cannot represent.
    assert.ok(Number.isInteger(THINKING_CREDIT_MULTIPLIER))
    assert.ok(THINKING_CREDIT_MULTIPLIER > 1)
  })

  it("keeps the worst-case thinking turn inside a sane share of the monthly allowance", () => {
    // MONTHLY_LIMIT is 100. A single turn must never be able to eat a fifth of it.
    const worstCase =
      creditsForSteps(MAX_DISCUSS_STEPS_THINKING, MAX_DISCUSS_STEPS_THINKING) *
      THINKING_CREDIT_MULTIPLIER
    assert.ok(worstCase <= 20, `worst-case thinking turn costs ${worstCase} credits`)
  })
})

describe("MAX_DISCUSS_STEPS_THINKING", () => {
  it("is higher than the normal ceiling", () => {
    assert.ok(MAX_DISCUSS_STEPS_THINKING > MAX_DISCUSS_STEPS)
  })

  it("is only safe because a wall-clock guard exists", () => {
    // At ~8x thinking latency this ceiling CAN exceed the 300s function limit on
    // step count alone. discuss.post.ts must strip tools on elapsed time too.
    // If that guard is ever removed, drop this ceiling back to MAX_DISCUSS_STEPS.
    assert.ok(MAX_DISCUSS_STEPS_THINKING <= 40)
  })
})

describe("stepCostNote", () => {
  it("states the flat 1-credit rate outside thinking mode", () => {
    assert.equal(
      stepCostNote(false),
      `Every ${STEPS_PER_CREDIT} steps costs the user one AI credit`,
    )
  })

  it("states the multiplied rate in thinking mode, not the flat rate", () => {
    // The runtime note exists so the model self-limits its research spend. In
    // thinking mode a turn bills creditsForSteps(steps, 40) *
    // THINKING_CREDIT_MULTIPLIER — the hardcoded "one credit" note under-reports
    // by 3x in exactly the mode where a turn can reach 15 credits.
    assert.equal(
      stepCostNote(true),
      `Every ${STEPS_PER_CREDIT} steps costs the user ${THINKING_CREDIT_MULTIPLIER} AI credits`,
    )
  })
})

describe("shouldStripTools", () => {
  it("leaves tools available early in a normal turn", () => {
    assert.equal(shouldStripTools(0, MAX_DISCUSS_STEPS, 0), false)
    assert.equal(shouldStripTools(5, MAX_DISCUSS_STEPS, 10_000), false)
  })

  it("strips tools on the last permitted step so the turn always writes a reply", () => {
    // Pre-existing behaviour: without this the loop could end on a tool call and
    // the user got silence.
    assert.equal(shouldStripTools(MAX_DISCUSS_STEPS - 1, MAX_DISCUSS_STEPS, 0), true)
  })

  it("strips tools once the time budget is spent, even with steps to spare", () => {
    // The guard that makes the raised thinking ceiling safe. 40 thinking steps
    // can exceed Vercel's 300s limit, and a timeout kills the process before the
    // refund runs — billing the user 3x for nothing.
    assert.equal(shouldStripTools(3, MAX_DISCUSS_STEPS_THINKING, TURN_TIME_BUDGET_MS + 1), true)
  })

  it("does not strip just below the time budget", () => {
    assert.equal(shouldStripTools(3, MAX_DISCUSS_STEPS_THINKING, TURN_TIME_BUDGET_MS - 1), false)
  })

  it("leaves headroom for the final reply inside the 300s function limit", () => {
    // The model still has to WRITE the answer after tools are stripped.
    assert.ok(TURN_TIME_BUDGET_MS <= 200_000)
  })
})

describe("chargedSoFar", () => {
  // Finding 3 (whole-branch review): ai.post.ts moved chargeExtraAiCredits to
  // run AFTER processUserRequest succeeds, so a failure before that point has
  // only ever consumed the flat 1-credit tryConsumeAiCredit call. Refunding
  // the full 3-credit creditsCharged there would mint the other 2 as free
  // credits (GREATEST(count-3,0) run against a ledger that only ever went up
  // by 1).
  it("is exactly 1 before the extra charge has run, regardless of the thinking price", () => {
    assert.equal(chargedSoFar(3, false), 1)
    assert.equal(chargedSoFar(1, false), 1)
  })

  it("is the full creditsCharged once the extra charge has succeeded", () => {
    assert.equal(chargedSoFar(3, true), 3)
  })

  it("is a no-op amount (1) for a non-thinking request either way", () => {
    // creditsCharged is 1 for a normal request, so pre/post-charge refund
    // amounts must coincide — there is no "extra" to under- or over-refund.
    assert.equal(chargedSoFar(1, false), chargedSoFar(1, true))
  })
})
