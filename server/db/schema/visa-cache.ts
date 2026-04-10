import { pgTable, text, timestamp, uuid, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const visaCache = pgTable(
  "visa_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passportCountry: text("passport_country").notNull(), // ISO alpha-2
    destinationCountry: text("destination_country").notNull(), // ISO alpha-2
    visaStatus: text("visa_status").notNull(), // visa_free, visa_on_arrival, e_visa, visa_required
    maxStayDays: integer("max_stay_days"),
    requirements: text("requirements"), // AI-generated summary
    processingTime: text("processing_time"),
    cost: text("cost"),
    notes: text("notes"),
    source: text("source"), // "ai_web_search"
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_visa_cache_lookup").on(table.passportCountry, table.destinationCountry),
  ]
);
