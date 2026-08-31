import "zod/compile"
import { eq } from "drizzle-orm"
import { db } from "../../db"
import { visaRequirements } from "../../db/schema"
import { z } from "zod"

const VISA_STATUS_PRIORITY: Record<string, number> = {
  "visa-free": 0,
  "visa-on-arrival": 1,
  evisa: 2,
  "visa-required": 3,
}

const querySchema = z.object({
  passport: z.string().length(2).toUpperCase(),
})

/**
 * Returns visa status for every destination for a given passport country.
 * Response: Record<destinationCountry, { visaStatus, maxStayDays }>
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { passport } = await getValidatedQuery(event, querySchema.parse)

  const results = await db.query.visaRequirements.findMany({
    where: eq(visaRequirements.passportCountry, passport),
    columns: { destinationCountry: true, visaStatus: true, maxStayDays: true },
  })

  const map: Record<string, { visaStatus: string; maxStayDays: number | null }> = {}

  for (const r of results) {
    const existing = map[r.destinationCountry]
    const rPriority = VISA_STATUS_PRIORITY[r.visaStatus] ?? 99
    const existingPriority = existing ? (VISA_STATUS_PRIORITY[existing.visaStatus] ?? 99) : 99

    if (rPriority < existingPriority) {
      map[r.destinationCountry] = {
        visaStatus: r.visaStatus,
        maxStayDays: r.maxStayDays,
      }
    }
  }

  // Home country is always visa-free
  map[passport] = { visaStatus: "visa-free", maxStayDays: null }

  return map
})
