import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const dashboardSource = readFileSync(fileURLToPath(new URL("./dashboard.vue", import.meta.url)), {
  encoding: "utf8",
})

describe("dashboard responsive section order", () => {
  it("places the trip brief before stats on mobile while preserving desktop order", () => {
    assert.match(dashboardSource, /<div class="flex flex-col gap-6 sm:gap-8">/)
    assert.match(
      dashboardSource,
      /<div[\s\S]*?v-if="stats"[\s\S]*?class="[^"]*\border-2\b[^"]*\bsm:order-1\b[^"]*"/,
    )
    assert.match(
      dashboardSource,
      /<PreTripBriefing[\s\S]*?v-if="dashboardBriefing"[\s\S]*?class="[^"]*\border-1\b[^"]*\bsm:order-2\b[^"]*"/,
    )
    assert.match(
      dashboardSource,
      /v-else-if="nextFlight \|\| \(nextTrip && countdown\)"[\s\S]*?class="[^"]*\border-1\b[^"]*\bsm:order-2\b[^"]*"/,
    )
  })
})
