import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema",
  out: "./server/db/migrations",
  dbCredentials: {
    // Vercel + Neon sets DATABASE_URL_UNPOOLED for direct connections (migrations need this)
    // Falls back to DATABASE_URL for local dev
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  },
});
