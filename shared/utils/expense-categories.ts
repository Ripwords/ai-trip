/**
 * Single source of truth for expense categories.
 *
 * The list was previously written twice — `expenseCategoryEnum` in
 * server/utils/schemas.ts and a hardcoded array plus badge map in
 * ExpenseTracker.vue — with nothing typing one against the other. Adding a
 * category server-side meant it never appeared in the picker, and any row
 * using it rendered with `other` styling.
 *
 * Lives in shared/ so both sides import it and the compiler catches drift.
 */

export const EXPENSE_CATEGORIES = [
  "accommodation",
  "food",
  "transport",
  "activity",
  "shopping",
  "other",
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/** Tailwind classes per category. Keyed by the union, so a new category won't compile until styled. */
export const EXPENSE_CATEGORY_BADGE_CLASSES: Record<ExpenseCategory, string> = {
  accommodation: "bg-ocean-50 text-ocean-700",
  food: "bg-terra-50 text-terra-700",
  transport: "bg-sand-100 text-sand-700",
  activity: "bg-ocean-50 text-ocean-700",
  shopping: "bg-terra-50 text-terra-600",
  other: "bg-sand-100 text-sand-700",
}

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value)
}

/** Badge classes for a category that may not be known (legacy rows, bad data). */
export function expenseCategoryBadgeClasses(category: string): string {
  return isExpenseCategory(category)
    ? EXPENSE_CATEGORY_BADGE_CLASSES[category]
    : EXPENSE_CATEGORY_BADGE_CLASSES.other
}
