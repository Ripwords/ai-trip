import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { dash } from "@better-auth/infra"
import { mcp } from "@better-auth/mcp"
import { eq, and } from "drizzle-orm"
import { db } from "../db"
import { admin, jwt } from "better-auth/plugins"
import { activityLog, tripMembers, user as userTable } from "../db/schema"

if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET must be set")

/** Where better-auth is mounted. Also the path RFC 8414 clients insert into the
 *  `/.well-known/oauth-authorization-server` probe, hence the export. */
export const AUTH_BASE_PATH = "/api/auth"

const MCP_RESOURCE_PATH = "/api/mcp"
const MCP_RESOURCE_FALLBACK = `http://localhost:3000${MCP_RESOURCE_PATH}`

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

/**
 * The RFC 8707 resource identifier for this MCP server.
 *
 * `mcp()` validates this at construction time and *throws* on anything that is
 * not HTTPS or HTTP-on-loopback — which would take down the whole app at import
 * time. `nuxt dev --host` advertising `http://192.168.1.5:3000` is exactly that
 * case, so an unusable base degrades to the loopback default instead.
 */
function resolveMcpResource(base: string | undefined): string {
  if (!base) {
    console.warn(
      `[mcp] NUXT_PUBLIC_BETTER_AUTH_URL is unset; MCP resource falls back to ${MCP_RESOURCE_FALLBACK}`,
    )
    return MCP_RESOURCE_FALLBACK
  }

  let url: URL
  try {
    url = new URL(MCP_RESOURCE_PATH, base)
  } catch {
    console.warn(
      `[mcp] NUXT_PUBLIC_BETTER_AUTH_URL is not a URL (${base}); MCP resource falls back to ${MCP_RESOURCE_FALLBACK}`,
    )
    return MCP_RESOURCE_FALLBACK
  }

  if (url.protocol === "https:") return url.toString()
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url.toString()

  console.warn(
    `[mcp] NUXT_PUBLIC_BETTER_AUTH_URL (${base}) is neither HTTPS nor loopback HTTP, which the MCP resource must be; falling back to ${MCP_RESOURCE_FALLBACK}`,
  )
  return MCP_RESOURCE_FALLBACK
}

export const MCP_RESOURCE = resolveMcpResource(process.env.NUXT_PUBLIC_BETTER_AUTH_URL)

const useSecure =
  process.env.BETTER_AUTH_URL?.startsWith("https://") ?? process.env.NODE_ENV === "production"

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NUXT_PUBLIC_BETTER_AUTH_URL,
  basePath: AUTH_BASE_PATH,
  appName: "AI Trip",
  experimental: {
    joins: true, // Enable database joins for better performance
  },
  trustedOrigins: (() => {
    const origins = ["http://localhost:3000"]
    const baseUrl = process.env.NUXT_PUBLIC_BETTER_AUTH_URL
    if (baseUrl) {
      // Normalize: use URL.origin to strip trailing slashes and paths
      try {
        const url = new URL(baseUrl)
        const origin = url.origin // e.g. "https://plantrip.my"
        origins.push(origin)
        // Also trust www/non-www variant
        if (url.hostname.startsWith("www.")) {
          origins.push(origin.replace("://www.", "://"))
        } else {
          origins.push(origin.replace("://", "://www."))
        }
      } catch {
        origins.push(baseUrl)
      }
    }
    return origins
  })(),
  database: drizzleAdapter(db, { provider: "pg" }),
  account: {
    encryptOAuthTokens: true,
  },
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
      strategy: "jwe", // Use JWE strategy for best security
    },
  },
  advanced: {
    // Use secure, httpOnly cookies — prevents XSS from stealing session tokens
    cookiePrefix: "ai-trip",
    useSecureCookies: useSecure,
    // Generate new session token on refresh to prevent session fixation
    generateId: undefined, // use default secure random ID generation
    ipAddress: {
      ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
    },
    defaultCookieAttributes: {
      sameSite: "lax",
    },
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
                eq(tripMembers.status, "pending"),
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

              await db.insert(activityLog).values({
                tripId: invite.tripId,
                userId: session.userId,
                action: "member_joined",
                description: `${user.name || user.email} joined the trip`,
              })
            }

            if (pendingInvites.length > 0) {
              console.log(
                `[auth] Auto-accepted ${pendingInvites.length} pending invite(s) for user ${session.userId}`,
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
      "/oauth2/token": { window: 60, max: 20 },
      "/oauth2/register": { window: 3600, max: 5 },
    },
  },
  plugins: [
    admin(),
    dash({
      activityTracking: {
        enabled: true,
        updateInterval: 300000, // Update interval in ms (default: 5 minutes)
      },
    }),
    // The oauth-provider behind mcp() reads the JWT plugin's options unguarded,
    // so the authorize flow throws without this.
    jwt(),
    mcp({
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      resource: MCP_RESOURCE,
      allowDynamicClientRegistration: true,
      // MCP clients register before anyone has signed in — that is the whole
      // shape of the flow, and a session-only gate locks every standard client
      // out at discovery. Registration on its own grants nothing: the client
      // still has to send a real user through /sign-in and /oauth/consent, and
      // the provider refuses `client_credentials` to an unauthenticated
      // registration, so no token is reachable without a human.
      allowUnauthenticatedClientRegistration: true,
      scopes: ["openid", "profile", "email", "offline_access", "trips:read", "trips:write"],
      // Session-backed registration and every other client mutation still run
      // through this. Without a callback there is no privilege check at all: any signed-in
      // user could register a client. A falsy return denies, and `undefined`
      // is falsy, so every allowed case must return `true` explicitly. `banned`
      // reaches us through the admin plugin's index signature, hence the narrowing.
      clientPrivileges: ({ user }) => user != null && user.banned !== true,
    }),
  ],
})
