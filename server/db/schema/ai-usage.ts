import { pgTable, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { user } from "./auth-schema"

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Year-month string like "2026-03" for easy querying
    month: text("month").notNull(),
    promptCount: integer("prompt_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_ai_usage_user_id").on(table.userId),
    uniqueIndex("idx_ai_usage_user_month").on(table.userId, table.month),
  ],
)
