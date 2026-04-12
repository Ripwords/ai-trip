/**
 * Startup assertion: fail fast if required environment variables are missing.
 */
export default defineNitroPlugin(() => {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY environment variable must be set")
  }
  if (!process.env.CRON_SECRET) {
    throw new Error("CRON_SECRET environment variable must be set")
  }
})
