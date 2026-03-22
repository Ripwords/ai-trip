import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    // Neon serverless WebSocket driver (supports transactions)
    // Vercel + Neon integration provides pooled DATABASE_URL automatically
    const { neonConfig, Pool } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
    const ws = require("ws") as typeof import("ws");
    neonConfig.webSocketConstructor = ws.default ?? ws;

    const { drizzle } = require("drizzle-orm/neon-serverless") as typeof import("drizzle-orm/neon-serverless");
    const pool = new Pool({ connectionString: url });
    return drizzle(pool, { schema });
  } else {
    // Local Docker Postgres via node-postgres
    const { drizzle } = require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
    const { Pool } = require("pg") as typeof import("pg");
    const pool = new Pool({
      connectionString: url,
      ssl: false,
      max: 10,
    });
    return drizzle({ client: pool, schema });
  }
}

export const db = createDb();
