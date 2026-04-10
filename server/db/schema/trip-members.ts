import { pgTable, text, uuid, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { trips } from "./trips"
import { user } from "./auth-schema"

export const tripMembers = pgTable(
  "trip_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("editor"), // "owner" | "editor" | "viewer"
    invitedBy: text("invited_by").references(() => user.id),
    invitedEmail: text("invited_email"), // email used for invite (before user joins)
    status: text("status").notNull().default("pending"), // "pending" | "active" | "expired"
    inviteToken: text("invite_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_trip_members_trip_id").on(table.tripId),
    index("idx_trip_members_user_id").on(table.userId),
    index("idx_trip_members_invited_email").on(table.invitedEmail),
  ],
)

export const tripMembersRelations = relations(tripMembers, ({ one }) => ({
  trip: one(trips, { fields: [tripMembers.tripId], references: [trips.id] }),
  user: one(user, { fields: [tripMembers.userId], references: [user.id] }),
}))
