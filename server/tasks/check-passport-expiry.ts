import { db } from "../db"
import { userPassports, user } from "../db/schema"
import { and, isNotNull, eq, lte, gt } from "drizzle-orm"
import { sendPassportExpiryEmail } from "../lib/email"
import { countries } from "../../app/data/countries"

const MILESTONES = [
  { key: "1m", months: 1, label: "1 month" },
  { key: "3m", months: 3, label: "3 months" },
  { key: "6m", months: 6, label: "6 months" },
] as const

function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setMonth(result.getMonth() + months)
  return result
}

function countryName(code: string): string {
  return countries.find((c) => c.alpha2 === code)?.name ?? code
}

export default defineTask({
  meta: {
    name: "check-passport-expiry",
    description: "Send email reminders for passports expiring within 6, 3, or 1 month",
  },
  async run() {
    const siteUrl = process.env.NUXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3000"
    const settingsUrl = `${siteUrl}/settings`

    // Find all passports with an expiry date set
    const passportsWithExpiry = await db
      .select({
        passportId: userPassports.id,
        userId: userPassports.userId,
        countryCode: userPassports.countryCode,
        expiryDate: userPassports.expiryDate,
        lastExpiryReminder: userPassports.lastExpiryReminder,
      })
      .from(userPassports)
      .where(
        and(
          isNotNull(userPassports.expiryDate),
          gt(userPassports.expiryDate, new Date().toISOString().split("T")[0]!),
        ),
      )

    const now = new Date()
    let sent = 0

    for (const passport of passportsWithExpiry) {
      if (!passport.expiryDate) continue

      const expiry = new Date(passport.expiryDate + "T00:00:00")

      // Determine which milestone we're at
      let currentMilestone: (typeof MILESTONES)[number] | null = null
      for (const milestone of MILESTONES) {
        const threshold = addMonths(now, milestone.months)
        if (expiry <= threshold) {
          currentMilestone = milestone
          break // First match = most urgent
        }
      }

      if (!currentMilestone) continue // Not within any reminder window

      // Skip if we already sent this milestone
      if (passport.lastExpiryReminder === currentMilestone.key) continue

      // Get the user's email
      const userData = await db.query.user.findFirst({
        where: eq(user.id, passport.userId),
        columns: { email: true, name: true },
      })

      if (!userData?.email) continue

      try {
        await sendPassportExpiryEmail({
          to: userData.email,
          userName: userData.name ?? "Traveler",
          countryName: countryName(passport.countryCode),
          expiryDate: passport.expiryDate,
          milestone: currentMilestone.label,
          settingsUrl,
        })

        // Mark this milestone as sent
        await db
          .update(userPassports)
          .set({ lastExpiryReminder: currentMilestone.key })
          .where(eq(userPassports.id, passport.passportId))

        sent++
        console.log(
          `[passport-expiry] Sent ${currentMilestone.label} reminder to ${userData.email} for ${passport.countryCode} passport`,
        )
      } catch (e) {
        console.error(`[passport-expiry] Failed to send reminder to ${userData.email}:`, e)
      }
    }

    console.log(`[passport-expiry] Sent ${sent} reminder(s)`)
    return { result: { sent } }
  },
})
