import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { sentinel, dash } from "@better-auth/infra"
import { eq, and } from "drizzle-orm"
import { db } from "../db"
import { tripMembers, user as userTable } from "../db/schema"

const isProduction = process.env.NODE_ENV === "production"

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NUXT_PUBLIC_BETTER_AUTH_URL,
  basePath: "/api/auth",
  trustedOrigins: [
    "http://localhost:3000",
    process.env.NUXT_PUBLIC_BETTER_AUTH_URL || "",
  ],
  database: drizzleAdapter(db, { provider: "pg" }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      prompt: "select_account",
      accessType: "offline",
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh session token every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // cache session in cookie for 5 min to reduce DB lookups
    },
  },
  advanced: {
    // Use secure, httpOnly cookies — prevents XSS from stealing session tokens
    cookiePrefix: "ai-trip",
    useSecureCookies: isProduction,
    // Generate new session token on refresh to prevent session fixation
    generateId: undefined, // use default secure random ID generation
  },
  // Auto-accept pending invites when a user signs in
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          try {
            // Find pending invites matching this user's email
            const user = await db.query.user.findFirst({
              where: eq(userTable.id, session.userId),
            })
            if (!user) return

            const pendingInvites = await db.query.tripMembers.findMany({
              where: and(
                eq(tripMembers.invitedEmail, user.email),
                eq(tripMembers.status, "pending")
              ),
            })

            for (const invite of pendingInvites) {
              // Check not expired
              if (invite.expiresAt && new Date() > invite.expiresAt) {
                await db
                  .update(tripMembers)
                  .set({ status: "expired" })
                  .where(eq(tripMembers.id, invite.id))
                continue
              }

              // Auto-accept
              await db
                .update(tripMembers)
                .set({
                  userId: session.userId,
                  status: "active",
                  inviteToken: null,
                })
                .where(eq(tripMembers.id, invite.id))
            }

            if (pendingInvites.length > 0) {
              console.log(
                `[auth] Auto-accepted ${pendingInvites.length} pending invite(s) for ${user.email}`
              )
            }
          } catch (e) {
            console.error("[auth] Failed to auto-accept invites:", e)
          }
        },
      },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      // Stricter rate limits on auth endpoints to prevent brute force
      "/sign-in/*": { window: 60, max: 10 },
      "/callback/*": { window: 60, max: 10 },
    },
  },
  plugins: [
    sentinel(),
    dash({
      activityTracking: {
        enabled: true,
        updateInterval: 300000, // Update interval in ms (default: 5 minutes)
      },
    }),
  ],
})
