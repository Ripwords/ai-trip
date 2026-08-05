import { and, count, sum } from "drizzle-orm"
import { db } from "../../../../db"
import { expenses } from "../../../../db/schema"
import { uuidParamsSchema, expenseListQuerySchema } from "../../../../utils/schemas"
import {
  buildExpenseCursorCondition,
  buildExpenseFilterConditions,
  expenseCursorForRow,
  expenseListOrderBy,
} from "../../../../lib/expense-list"
import { decodeExpenseCursor, type ExpenseListPage } from "../../../../../shared/utils/expense-list"
import {
  attachmentsByExpense,
  type ExpenseAttachmentSummary,
} from "../../../../lib/expense-attachments"

/**
 * The trip's expenses, filtered, sorted and paginated by the database — #49.
 *
 * This used to be `select * from expenses where trip_id = ?` with no query
 * parameters at all, and the browser did the rest. The response is now a page
 * object rather than a bare array.
 *
 * `filteredCount` / `filteredTotal` describe the current filter across every
 * page. Trip-wide money stays in `GET /expenses/summary` and never follows the
 * filter — a budget or a settlement computed from a subset of the expenses
 * would be wrong, not merely narrower.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const query = await getValidatedQuery(event, expenseListQuerySchema.parse)

  await requireTripAccess(id, session.user.id)

  const filterConditions = buildExpenseFilterConditions(id, query)
  const pageConditions = [...filterConditions]

  if (query.cursor) {
    const cursor = decodeExpenseCursor(query.cursor)
    if (!cursor) {
      throw createError({ statusCode: 400, message: "Invalid cursor" })
    }
    // A cursor is a position in one particular ordering. Reusing it against a
    // different sort would page through the wrong column.
    if (cursor.field !== query.sort) {
      throw createError({ statusCode: 400, message: "Cursor does not match the requested sort" })
    }
    const condition = buildExpenseCursorCondition(cursor, query.order)
    if (condition) pageConditions.push(condition)
  }

  // One extra row is the "is there another page" probe — cheaper and race-free
  // compared with re-counting, and it never appears in the response.
  const [rows, aggregate] = await Promise.all([
    db.query.expenses.findMany({
      where: and(...pageConditions),
      orderBy: expenseListOrderBy(query.sort, query.order),
      limit: query.limit + 1,
    }),
    db
      .select({ matched: count(), total: sum(expenses.amount) })
      .from(expenses)
      .where(and(...filterConditions)),
  ])

  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows
  const last = items.at(-1)

  const totals = aggregate[0]

  // Receipts for the page, in one query (#48). Rendering a thumbnail per row
  // must not cost a request per row.
  const receipts = await attachmentsByExpense(
    id,
    items.map((item) => item.id),
  )

  const page: ExpenseListPage<(typeof rows)[number] & { attachments: ExpenseAttachmentSummary[] }> =
    {
      items: items.map((item) => ({ ...item, attachments: receipts.get(item.id) ?? [] })),
      nextCursor: hasMore && last ? expenseCursorForRow(last, query.sort) : null,
      filteredCount: Number(totals?.matched ?? 0),
      // `sum()` is NULL when nothing matched, and a string otherwise.
      filteredTotal: Number(totals?.total ?? 0),
    }

  return page
})
