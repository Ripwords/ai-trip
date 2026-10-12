/** Above this many expenses the filters earn their space; at or below it they wait behind a button. */
export const EXPENSE_FILTERS_THRESHOLD = 10

export interface ExpenseFilterVisibility {
  /** The category / payer / sort / date controls. */
  showGrid: boolean
  /** The "Filter" button that opens them. */
  showToggle: boolean
}

export function expenseFilterVisibility(input: {
  expenseCount: number
  filtersActive: boolean
  opened: boolean
}): ExpenseFilterVisibility {
  // Active filters stay on screen whatever the count: they may have selected
  // nothing, and the way to undo that must not be hidden.
  if (input.filtersActive || input.expenseCount > EXPENSE_FILTERS_THRESHOLD) {
    return { showGrid: true, showToggle: false }
  }
  if (input.expenseCount === 0) return { showGrid: false, showToggle: false }
  return { showGrid: input.opened, showToggle: true }
}
