import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

const page = read("./pages/trips/[id].vue")
const tabs = read("./components/TripDetailTabs.vue")
const dock = read("./components/AiDock.vue")

describe("trip page default tab (U2)", () => {
  it("opens on the itinerary, the primary task", () => {
    assert.ok(
      /const activeTab = ref<TabValue>\("itinerary"\)/.test(page),
      "default tab is not itinerary",
    )
  })

  it("lists the default tab first in the tab bar", () => {
    const first = tabs.match(/primaryTabs = \[\s*\{ value: "(\w+)"/)
    assert.equal(first?.[1], "itinerary")
  })
})

describe("whole-trip generation is named for what it does (U1)", () => {
  it("labels the dock chip as the whole trip, not a day", () => {
    assert.ok(!/Generate full day/.test(dock), "dock still says 'Generate full day'")
    assert.ok(/label: "Generate whole trip"/.test(dock), "dock chip is not 'Generate whole trip'")
  })

  it("offers it as the primary action while no day has activities", () => {
    const block = page.match(/<!-- Empty itinerary -->[\s\S]*?<\/section>/)
    assert.ok(block, "no empty-itinerary state on the page")
    assert.ok(/v-if="!hasActivities && !isViewer"/.test(block[0]), "empty state not gated")
    assert.ok(/@click="handleGenerateFullItinerary"/.test(block[0]), "button does not generate")
    assert.ok(/Generate whole trip/.test(block[0]), "button is not labelled")
    assert.ok(/bg-cta/.test(block[0]), "button is not styled as the primary action")
  })
})
