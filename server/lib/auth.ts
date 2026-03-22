import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db";

const isProduction = process.env.NODE_ENV === "production";

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
});
