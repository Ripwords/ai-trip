import { pgTable, text, timestamp, uuid, boolean, uniqueIndex, date } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { user } from "./auth-schema"
import { encryptedText } from "../custom-types"

export const userPassports = pgTable(
  "user_passports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    countryCode: text("country_code").notNull(), // ISO alpha-2
    label: text("label"),
    passportNumber: encryptedText("passport_number"), // AES-256-GCM encrypted
    expiryDate: date("expiry_date"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idx_user_passports_user_country").on(table.userId, table.countryCode)],
)

export const userPassportsRelations = relations(userPassports, ({ one }) => ({
  user: one(user, { fields: [userPassports.userId], references: [user.id] }),
}))
