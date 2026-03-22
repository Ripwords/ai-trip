import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import ws from "ws";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

let db: ReturnType<typeof drizzlePg>;

if (process.env.NODE_ENV === "production") {
  neonConfig.webSocketConstructor = ws;
  const pool = new NeonPool({ connectionString: url });
  db = drizzleNeon(pool, { schema }) as unknown as typeof db;
} else {
  const pool = new PgPool({ connectionString: url, ssl: false, max: 10 });
  db = drizzlePg({ client: pool, schema });
}

export { db };
