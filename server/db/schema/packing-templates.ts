import {
  pgTable, uuid, text, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./auth-schema";

export interface PackingTemplateItem {
  text: string;
  category: string;
}

export const packingTemplates = pgTable(
  "packing_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    isGlobal: boolean("is_global").notNull().default(false),
    items: jsonb("items").$type<PackingTemplateItem[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_packing_templates_user_id").on(table.userId),
    index("idx_packing_templates_is_global").on(table.isGlobal),
  ]
);

export const packingTemplatesRelations = relations(packingTemplates, ({ one }) => ({
  user: one(user, { fields: [packingTemplates.userId], references: [user.id] }),
}));
