import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

export const db = process.env.NODE_ENV === "production"
  ? drizzleNeon(url, { schema }) as unknown as ReturnType<typeof drizzlePg>
  : drizzlePg(url, { schema });
