import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./auth-schema";

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nationality: text("nationality"), // ISO 3166-1 alpha-2 — passport country
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_user_profiles_user_id").on(table.userId),
  ]
);

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(user, { fields: [userProfiles.userId], references: [user.id] }),
}));
