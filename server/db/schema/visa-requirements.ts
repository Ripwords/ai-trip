import { pgTable, text, timestamp, uuid, integer, uniqueIndex } from "drizzle-orm/pg-core"

export const visaRequirements = pgTable(
  "visa_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    passportCountry: text("passport_country").notNull(), // ISO alpha-2
    destinationCountry: text("destination_country").notNull(), // ISO alpha-2
    visaStatus: text("visa_status").notNull(), // visa-free, visa-required, evisa, visa-on-arrival
    maxStayDays: integer("max_stay_days"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_visa_req_lookup").on(table.passportCountry, table.destinationCountry),
  ],
)
