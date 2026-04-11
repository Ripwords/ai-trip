import { z } from "zod"
import { checkVisaRequirements } from "../../lib/visa-checker"
import { countryByAlpha2 } from "../../../app/data/countries"

const querySchema = z.object({
  destination: z.string().length(2).toUpperCase(),
  passport: z.string().length(2).toUpperCase(),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { destination, passport } = await getValidatedQuery(event, querySchema.parse)

  const passportName = countryByAlpha2.get(passport)?.name ?? passport
  const destinationName = countryByAlpha2.get(destination)?.name ?? destination

  const result = await checkVisaRequirements(passport, destination, passportName, destinationName)

  return {
    requirements: result.requirements,
    processingTime: result.processingTime,
    cost: result.cost,
    notes: result.notes,
  }
})
