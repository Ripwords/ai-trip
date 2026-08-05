/**
 * The wire contract for `GET /api/trips/:id/expenses` — issue #49.
 *
 * The endpoint used to return every row of a trip, unfiltered and unordered
 * beyond `created_at desc`, and the browser then filtered, sorted and re-summed
 * the whole array on every surface that needed a number. Filtering and sorting
 * are now the database's job; this module holds the parts both sides need to
 * agree on — the sort vocabulary, the page sizes, and the cursor format.
 */

export const EXPENSE_SORT_FIELDS = ["paidAt", "amount", "createdAt"] as const
export type ExpenseSortField = (typeof EXPENSE_SORT_FIELDS)[number]

export const EXPENSE_SORT_ORDERS = ["asc", "desc"] as const
export type ExpenseSortOrder = (typeof EXPENSE_SORT_ORDERS)[number]

/**
 * Page sizes. The per-trip cap is 200 rows (server/lib/expense-cap.ts), so
 * pagination here is about keeping the payload and the render small rather than
 * about unbounded data — asking for more than the cap can ever return is
 * meaningless, hence the ceiling.
 */
export const EXPENSE_PAGE_SIZE_DEFAULT = 50
export const EXPENSE_PAGE_SIZE_MAX = 200

/**
 * Keyset position. `value` is the sort column of the last row of the previous
 * page — `null` only for `paidAt`, which is the one nullable sort column.
 */
export interface ExpenseCursor {
  field: ExpenseSortField
  value: string | null
  id: string
}

function isSortField(value: unknown): value is ExpenseSortField {
  return (EXPENSE_SORT_FIELDS as readonly unknown[]).includes(value)
}

/** base64url with the padding stripped, so the token is querystring-safe. */
export function encodeExpenseCursor(cursor: ExpenseCursor): string {
  const json = JSON.stringify([cursor.field, cursor.value, cursor.id])
  return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

/**
 * Decode a cursor, returning `null` for anything that is not one. A cursor is
 * user input: it arrives in the query string and can be edited, truncated or
 * fabricated, so every field is checked rather than trusted.
 */
export function decodeExpenseCursor(raw: string): ExpenseCursor | null {
  if (!raw) return null
  try {
    const base64 = raw.replaceAll("-", "+").replaceAll("_", "/")
    const parsed: unknown = JSON.parse(atob(base64))
    if (!Array.isArray(parsed) || parsed.length !== 3) return null
    const [field, value, id] = parsed as [unknown, unknown, unknown]
    if (!isSortField(field)) return null
    if (value !== null && typeof value !== "string") return null
    if (typeof id !== "string" || id.length === 0) return null
    // Only `paid_at` is nullable; a null cursor value for any other column
    // could only come from a forged token.
    if (value === null && field !== "paidAt") return null
    return { field, value, id }
  } catch {
    return null
  }
}

/**
 * The query string as the client holds it. Everything is a string because that
 * is what a query string is; `""` means "not filtered" on both sides.
 */
export interface ExpenseListParams {
  category: string
  payerId: string
  from: string
  to: string
  sort: ExpenseSortField
  order: ExpenseSortOrder
  limit: string
}

/**
 * One page of expenses.
 *
 * `filteredCount` and `filteredTotal` describe *the filter*, across every page,
 * not the page in hand. Trip-wide money — budget, settlement, per-category
 * breakdown — deliberately stays in `GET /expenses/summary` and never follows
 * the filter, because a settlement computed from a subset of the expenses is
 * simply wrong. So: the summary answers "what does this trip cost", these two
 * fields answer "what did I just select".
 */
export interface ExpenseListPage<TItem> {
  items: TItem[]
  /** Pass back as `?cursor=` for the next page; `null` when this is the last. */
  nextCursor: string | null
  filteredCount: number
  filteredTotal: number
}
