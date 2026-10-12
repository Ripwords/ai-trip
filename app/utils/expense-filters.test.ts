import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { EXPENSE_FILTERS_THRESHOLD, expenseFilterVisibility } from "./expense-filters"

const tracker = readFileSync(
  fileURLToPath(new URL("../components/ExpenseTracker.vue", import.meta.url)),
  "utf8",
)

describe("expenseFilterVisibility (U7)", () => {
  it("shows nothing when there is nothing to filter", () => {
    assert.deepEqual(
      expenseFilterVisibility({ expenseCount: 0, filtersActive: false, opened: false }),
      {
        showGrid: false,
        showToggle: false,
      },
    )
  })

  it("puts a short list's filters behind a button", () => {
    assert.equal(EXPENSE_FILTERS_THRESHOLD, 10)
    assert.deepEqual(
      expenseFilterVisibility({ expenseCount: 10, filtersActive: false, opened: false }),
      {
        showGrid: false,
        showToggle: true,
      },
    )
    assert.deepEqual(
      expenseFilterVisibility({ expenseCount: 3, filtersActive: false, opened: true }),
      {
        showGrid: true,
        showToggle: true,
      },
    )
  })

  it("shows a long list's filters outright", () => {
    assert.deepEqual(
      expenseFilterVisibility({ expenseCount: 11, filtersActive: false, opened: false }),
      {
        showGrid: true,
        showToggle: false,
      },
    )
  })

  it("never hides filters that are narrowing the list", () => {
    assert.deepEqual(
      expenseFilterVisibility({ expenseCount: 4, filtersActive: true, opened: false }),
      {
        showGrid: true,
        showToggle: false,
      },
    )
    // Filters can select nothing; the controls to undo that must stay reachable.
    assert.deepEqual(
      expenseFilterVisibility({ expenseCount: 0, filtersActive: true, opened: false }),
      {
        showGrid: true,
        showToggle: false,
      },
    )
  })
})

describe("ExpenseTracker layout (U7)", () => {
  it("gates the filter grid on the visibility rule", () => {
    assert.ok(/expenseFilterVisibility\(/.test(tracker), "filter grid is always shown")
    assert.ok(/v-if="filterVisibility\.showGrid"/.test(tracker), "grid not gated")
    assert.ok(/:aria-expanded="filtersOpen"/.test(tracker), "Filter button is not a disclosure")
  })

  it("folds Currencies and Planned vs actual into one collapsed Breakdown", () => {
    const block = tracker.match(/<details[^>]*>[\s\S]*?<\/details>/)
    assert.ok(block, "no collapsible breakdown")
    assert.ok(/Breakdown/.test(block[0]), "breakdown is not labelled")
    assert.ok(/Currencies/.test(block[0]) && /Planned vs actual/.test(block[0]), "not merged")
    assert.ok(!/<details[^>]*\sopen/.test(block[0]), "breakdown starts open")
    assert.equal(tracker.match(/Currencies/g)?.length, 1, "a separate Currencies card remains")
  })
})
