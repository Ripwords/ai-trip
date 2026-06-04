import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const dashboardSource = readFileSync(fileURLToPath(new URL("./dashboard.vue", import.meta.url)), {
  encoding: "utf8",
})

describe("dashboard responsive section order", () => {
  it("places the trip prompt before passport and trips content", () => {
    assert.match(dashboardSource, /<div class="flex flex-col gap-6 sm:gap-8">/)
    assert.match(
      dashboardSource,
      /<PreTripBriefing[\s\S]*?v-if="dashboardBriefing"[\s\S]*?class="[^"]*\border-1\b[^"]*"/,
    )
    assert.match(
      dashboardSource,
      /v-else-if="nextFlight \|\| \(nextTrip && countdown\)"[\s\S]*?class="[^"]*\border-1\b[^"]*"/,
    )
    assert.match(dashboardSource, /<PassportHero[\s\S]*?class="[^"]*\border-3\b[^"]*"/)
    assert.match(dashboardSource, /<!-- Trips section -->[\s\S]*?<div class="order-5">/)
  })
})
