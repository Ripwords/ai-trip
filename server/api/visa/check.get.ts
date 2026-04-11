import { and, eq, inArray } from "drizzle-orm"
import { db } from "../../db"
import { visaRequirements, userPassports } from "../../db/schema"
import { visaCheckQuerySchema } from "../../utils/schemas"

const VISA_STATUS_PRIORITY: Record<string, number> = {
  "visa-free": 0,
  "visa-on-arrival": 1,
  evisa: 2,
  "visa-required": 3,
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { destination } = await getValidatedQuery(event, visaCheckQuerySchema.parse)

  // Get all user passports
  const passports = await db.query.userPassports.findMany({
    where: eq(userPassports.userId, session.user.id),
  })

  if (passports.length === 0) {
    throw createError({
      statusCode: 400,
      message: "No passports configured. Please add a passport in settings.",
    })
  }

  const countryCodes = passports.map((p) => p.countryCode)

  // Check if any passport is from the destination country
  const homePassport = passports.find((p) => p.countryCode === destination)
  if (homePassport) {
    return {
      visaStatus: "visa-free",
      maxStayDays: null,
      passportCountry: homePassport.countryCode,
      destinationCountry: destination,
      isHomeCountry: true,
    }
  }

  // Look up visa requirements for all passports
  const results = await db.query.visaRequirements.findMany({
    where: and(
      inArray(visaRequirements.passportCountry, countryCodes),
      eq(visaRequirements.destinationCountry, destination),
    ),
  })

  if (results.length === 0) {
    return {
      visaStatus: "unknown",
      maxStayDays: null,
      passportCountry: passports[0]!.countryCode,
      destinationCountry: destination,
      isHomeCountry: false,
    }
  }

  // Return the most favorable result
  const best = results.toSorted(
    (a, b) =>
      (VISA_STATUS_PRIORITY[a.visaStatus] ?? 99) - (VISA_STATUS_PRIORITY[b.visaStatus] ?? 99),
  )[0]!

  return {
    visaStatus: best.visaStatus,
    maxStayDays: best.maxStayDays,
    passportCountry: best.passportCountry,
    destinationCountry: best.destinationCountry,
    isHomeCountry: false,
  }
})
