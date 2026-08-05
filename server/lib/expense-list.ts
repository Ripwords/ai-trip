import { and, asc, desc, eq, gt, gte, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm"
import { expenses } from "../db/schema"
import type {
  ExpenseCursor,
  ExpenseSortField,
  ExpenseSortOrder,
} from "../../shared/utils/expense-list"
import type { ExpenseCategory } from "../../shared/utils/expense-categories"
import { encodeExpenseCursor } from "../../shared/utils/expense-list"

/**
 * Server-side filtering, sorting and keyset pagination for the expense list —
 * issue #49. Kept out of the route handler so the generated SQL can be compiled
 * and asserted directly (see expense-list.test.ts).
 */

export interface ExpenseListFilters {
  category?: ExpenseCategory
  /** A user id, or the literal `"none"` for expenses with no payer recorded. */
  payerId?: string
  /** Inclusive `paid_at` bounds, as calendar dates. */
  from?: string
  to?: string
}

/** The sentinel `?payerId=` value meaning "nobody was recorded as paying". */
export const UNATTRIBUTED_PAYER = "none"

const SORT_COLUMNS = {
  paidAt: expenses.paidAt,
  amount: expenses.amount,
  createdAt: expenses.createdAt,
} as const

/** `paid_at` is the only nullable sort column, which the keyset has to know. */
const NULLABLE_SORT_FIELDS = new Set<ExpenseSortField>(["paidAt"])

/**
 * Cursor values travel as strings; the column decides what they mean. Getting
 * this wrong is silent: a `created_at` cursor bound as text compares
 * lexicographically against a timestamp and pages incorrectly.
 */
function cursorValue(field: ExpenseSortField, value: string): string | Date {
  return field === "createdAt" ? new Date(value) : value
}

/**
 * Everything except the keyset. Returned as an array rather than a single
 * `and(...)` so the caller can reuse it for the aggregate query, which must see
 * the filter but not the cursor.
 */
export function buildExpenseFilterConditions(tripId: string, filters: ExpenseListFilters): SQL[] {
  const conditions: SQL[] = [eq(expenses.tripId, tripId)]

  if (filters.category) conditions.push(eq(expenses.category, filters.category))

  if (filters.payerId) {
    conditions.push(
      filters.payerId === UNATTRIBUTED_PAYER
        ? isNull(expenses.paidById)
        : eq(expenses.paidById, filters.payerId),
    )
  }

  // Rows with no `paid_at` fall outside any date range — SQL's own semantics,
  // and the honest answer: an expense with no date is not in August.
  if (filters.from) conditions.push(gte(expenses.paidAt, filters.from))
  if (filters.to) conditions.push(lte(expenses.paidAt, filters.to))

  return conditions
}

/**
 * `ORDER BY`, always tie-broken by id. Without the tie-break, two expenses on
 * the same day have no defined order between them, and a keyset page boundary
 * that lands inside the tie either repeats a row or skips one.
 */
export function expenseListOrderBy(field: ExpenseSortField, order: ExpenseSortOrder): SQL[] {
  const column = SORT_COLUMNS[field]
  const direction = order === "asc" ? asc : desc

  // Undated rows sort last in both directions. Postgres would otherwise put
  // them first when descending, so the very first page of the default sort
  // would be nothing but expenses whose date nobody filled in.
  const primary = NULLABLE_SORT_FIELDS.has(field)
    ? order === "asc"
      ? sql`${column} asc nulls last`
      : sql`${column} desc nulls last`
    : direction(column)

  return [primary as SQL, direction(expenses.id) as SQL]
}

/**
 * "Everything strictly after this row" in the given order.
 *
 * The null branch is what makes `nulls last` paginate correctly: descending
 * from a dated row, the remaining rows are the earlier-dated ones *and* the
 * whole undated tail; once the cursor is itself on an undated row, only the
 * undated tail is left.
 */
export function buildExpenseCursorCondition(
  cursor: ExpenseCursor,
  order: ExpenseSortOrder,
): SQL | undefined {
  const column = SORT_COLUMNS[cursor.field]
  const beyond = order === "asc" ? gt : lt

  if (cursor.value === null) {
    if (!NULLABLE_SORT_FIELDS.has(cursor.field)) return undefined
    return and(isNull(expenses.paidAt), beyond(expenses.id, cursor.id))
  }

  const value = cursorValue(cursor.field, cursor.value)
  const sameValueLaterRow = and(eq(column, value), beyond(expenses.id, cursor.id))

  return NULLABLE_SORT_FIELDS.has(cursor.field)
    ? or(beyond(column, value), sameValueLaterRow, isNull(column))
    : or(beyond(column, value), sameValueLaterRow)
}

/** The subset of an expense row a cursor is built from. */
export interface ExpenseCursorRow {
  id: string
  paidAt: string | null
  amount: string
  createdAt: Date
}

/**
 * The cursor pointing *at* a row, for the given sort. It must read the same
 * column the ORDER BY used, or the next page silently starts somewhere else.
 */
export function expenseCursorForRow(row: ExpenseCursorRow, field: ExpenseSortField): string {
  const value =
    field === "paidAt" ? row.paidAt : field === "amount" ? row.amount : row.createdAt.toISOString()
  return encodeExpenseCursor({ field, value, id: row.id })
}
