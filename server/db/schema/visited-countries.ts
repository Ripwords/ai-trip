import { pgTable, text, timestamp, uuid, date, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./auth-schema";

export const visitedCountries = pgTable(
  "visited_countries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    countryCode: text("country_code").notNull(), // ISO 3166-1 alpha-2
    countryName: text("country_name").notNull(),
    visitType: text("visit_type").notNull().default("visited"), // "visited" | "layover"
    visitedAt: date("visited_at"), // optional: when they visited
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_visited_countries_user_country").on(table.userId, table.countryCode),
    index("idx_visited_countries_user_id").on(table.userId),
  ]
);

export const visitedCountriesRelations = relations(visitedCountries, ({ one }) => ({
  user: one(user, { fields: [visitedCountries.userId], references: [user.id] }),
}));
