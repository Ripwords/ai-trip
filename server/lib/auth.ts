import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db";

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
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
  },
});
