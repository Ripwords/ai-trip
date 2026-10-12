import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { LOW_CREDITS_THRESHOLD, lowCreditsNotice } from "./credits"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

const dock = read("../components/AiDock.vue")
const page = read("../pages/trips/[id].vue")
const settings = read("../pages/settings.vue")

describe("lowCreditsNotice (U5)", () => {
  it("stays quiet while credits are plentiful or unknown", () => {
    assert.equal(lowCreditsNotice(null), null)
    assert.equal(lowCreditsNotice(undefined), null)
    assert.equal(lowCreditsNotice(LOW_CREDITS_THRESHOLD + 1), null)
    assert.equal(lowCreditsNotice(90), null)
  })

  it("speaks up at the threshold and below", () => {
    assert.equal(LOW_CREDITS_THRESHOLD, 10)
    assert.equal(lowCreditsNotice(10), "10 AI credits left this month.")
    assert.equal(lowCreditsNotice(2), "2 AI credits left this month.")
  })

  it("uses the singular for one credit", () => {
    assert.equal(lowCreditsNotice(1), "1 AI credit left this month.")
  })

  it("says when they are gone", () => {
    assert.equal(lowCreditsNotice(0), "You're out of AI credits. They reset next month.")
    assert.equal(lowCreditsNotice(-3), "You're out of AI credits. They reset next month.")
  })
})

describe("usage counters stay out of the main view (U5)", () => {
  it("drops the used/limit counter and the per-reply cost line from the dock", () => {
    assert.ok(!/usageUsed/.test(dock), "dock still renders a used/limit counter")
    assert.ok(!/monthly credits/.test(dock), "dock empty state still quotes the allowance")
    assert.ok(/lowCreditsNotice\(/.test(dock), "dock has no low-credit notice")
  })

  it("drops the running cost from the generation pill", () => {
    assert.ok(!/generateCreditsSpent/.test(page), "generation pill still counts credits")
  })

  it("never calls them prompts", () => {
    assert.ok(!/prompts? used/i.test(settings), "settings still says prompts")
    assert.ok(!/prompts used/i.test(dock), "dock still says prompts")
    assert.ok(/credits used/.test(settings), "settings does not say credits")
  })
})
