import { neonConfig, Pool } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"
import { WebSocket } from "ws"
import * as schema from "./schema"

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error("DATABASE_URL is not set")
}

const isNeonRemote = connectionString.includes("neon.tech")
const useLocalProxy = !isNeonRemote && (import.meta.dev || process.env.LOCAL_PG_PROXY === "1")

if (useLocalProxy) {
  neonConfig.wsProxy = (host) => `${host}:5433/v1`
  neonConfig.useSecureWebSocket = false
  neonConfig.pipelineTLS = false
  neonConfig.pipelineConnect = false
} else {
  neonConfig.webSocketConstructor = WebSocket
  neonConfig.poolQueryViaFetch = true
}

const pool = new Pool({ connectionString })
export const db = drizzle(pool, { schema })
