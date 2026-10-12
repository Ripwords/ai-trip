import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

const page = read("./pages/trips/[id].vue")
const tabs = read("./components/TripDetailTabs.vue")

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
