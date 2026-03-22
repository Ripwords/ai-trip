import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

export const db = import.meta.dev ? drizzle(url, { schema }) : drizzleNeon(url, { schema });
