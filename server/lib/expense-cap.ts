import { and, eq, lt, sql } from "drizzle-orm"
import { db } from "../db"
import { trips } from "../db/schema"

/**
 * Per-trip expense limit. It exists to stop runaway growth (the list endpoint
 * returns every row), not to be a meaningful product rule.
 */
export const EXPENSE_CAP = 200

/**
 * The database handle, or the transaction handle `db.transaction` hands its
 * callback. Both expose the query builders used here.
 */
export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Claim one of the trip's expense slots, or throw 400 if there are none left.
 *
 * Replaces `select count(*) from expenses where trip_id = ?`, which ran on
 * every insert and was a read-then-write race: two writers both read 199, both
 * passed the check, and the trip ended up with 201 rows.
 *
 * The conditional UPDATE is a single atomic statement. Postgres takes the
 * trip's row lock to apply it, so a concurrent writer blocks until the first
 * transaction ends and then re-evaluates `expense_count < cap` against the
 * committed value — one of the two racers gets zero rows back and is refused.
 * Cost is a primary-key update rather than a scan that grows with the table.
 *
 * Call inside the same transaction as the insert so a failed insert releases
 * the slot on rollback.
 */
export async function reserveExpenseSlot(tripId: string, tx: DbOrTx = db): Promise<number> {
  const [reserved] = await tx
    .update(trips)
    .set({
      expenseCount: sql`${trips.expenseCount} + 1`,
      // Adding an expense is not an edit of the trip itself; passing the column
      // through explicitly stops `$onUpdate` from bumping `updated_at`.
      updatedAt: sql`${trips.updatedAt}`,
    })
    .where(and(eq(trips.id, tripId), lt(trips.expenseCount, EXPENSE_CAP)))
    .returning({ expenseCount: trips.expenseCount })

  if (!reserved) {
    throw createError({
      statusCode: 400,
      message: `Maximum number of expenses per trip reached (${EXPENSE_CAP})`,
    })
  }

  return reserved.expenseCount
}

/**
 * Give a slot back after deleting an expense, so the cap is a live limit rather
 * than a lifetime quota. `greatest(…, 0)` keeps the counter inside its CHECK
 * constraint even if it ever drifts below the real row count.
 */
export async function releaseExpenseSlot(tripId: string, tx: DbOrTx = db): Promise<void> {
  await tx
    .update(trips)
    .set({
      expenseCount: sql`greatest(${trips.expenseCount} - 1, 0)`,
      updatedAt: sql`${trips.updatedAt}`,
    })
    .where(eq(trips.id, tripId))
}
