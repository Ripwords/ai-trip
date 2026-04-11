import { db } from "../db"

/**
 * On server startup, check if the visa_requirements table is empty.
 * If so, run the import task to seed it. This handles first deployment
 * without needing a manual import step.
 */
export default defineNitroPlugin(async () => {
  try {
    const existing = await db.query.visaRequirements.findFirst()
    if (existing) return // Already seeded, skip

    console.log("[seed-visa-data] visa_requirements table is empty, importing dataset...")
    const { result } = await runTask("import-visa-data")
    console.log("[seed-visa-data] Import complete:", result)
  } catch (e) {
    // Don't crash the server if the import fails
    console.error("[seed-visa-data] Failed to auto-import visa data:", e)
  }
})
