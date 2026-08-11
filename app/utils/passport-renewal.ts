import { countryByAlpha2, countryFlag } from "../data/countries"

/** Milestones the expiry-reminder email fires on. Shared so the reminder and
 *  the UI can never drift apart on what counts as urgent. */
export const EXPIRY_REMINDER_MILESTONES = [
  { key: "1m", months: 1, label: "1 month" },
  { key: "3m", months: 3, label: "3 months" },
  { key: "6m", months: 6, label: "6 months" },
] as const

export type ExpiryReminderMilestone = (typeof EXPIRY_REMINDER_MILESTONES)[number]

/** Most destinations refuse entry unless the passport stays valid this long
 *  past the arrival date. */
export const VALIDITY_RULE_MONTHS = 6

/** Slack for renewal processing on top of the validity rule. */
export const PROCESSING_BUFFER_MONTHS = 3

/** How far ahead of expiry we tell people to start renewing. */
export const RENEWAL_LEAD_MONTHS = VALIDITY_RULE_MONTHS + PROCESSING_BUFFER_MONTHS

export interface RenewalPassport {
  countryCode: string
  expiryDate: string | null
  isDefault: boolean
}

export type PassportRenewalStatus =
  | "unknown" // no expiry recorded
  | "valid" // renewal window has not opened
  | "plan" // inside the recommended renewal window
  | "urgent" // below the 6-month validity rule
  | "critical" // below 3 months
  | "expired"

export type PassportRenewalTone = "good" | "info" | "warn" | "danger"

export interface PassportRenewal {
  countryCode: string
  countryName: string
  flag: string
  isDefault: boolean
  expiryDate: string | null
  recommendedRenewalDate: string | null
  daysUntilExpiry: number | null
  monthsUntilExpiry: number | null
  status: PassportRenewalStatus
  tone: PassportRenewalTone
  headline: string
  detail: string
}

const STATUS_RANK: Record<PassportRenewalStatus, number> = {
  expired: 0,
  critical: 1,
  urgent: 2,
  plan: 3,
  valid: 4,
  unknown: 5,
}

export function buildPassportRenewal(
  passport: RenewalPassport,
  now: Date = new Date(),
): PassportRenewal {
  const code = passport.countryCode.toUpperCase()
  const base = {
    countryCode: code,
    countryName: countryByAlpha2.get(code)?.name ?? code,
    flag: countryFlag(code),
    isDefault: passport.isDefault,
    expiryDate: passport.expiryDate,
  }

  if (!passport.expiryDate) {
    return {
      ...base,
      recommendedRenewalDate: null,
      daysUntilExpiry: null,
      monthsUntilExpiry: null,
      status: "unknown",
      tone: "info",
      headline: "Expiry date not set",
      detail: "Add an expiry date in settings to get renewal reminders.",
    }
  }

  const today = startOfDay(now)
  const expiry = parseDateOnly(passport.expiryDate)
  const recommended = shiftMonths(expiry, -RENEWAL_LEAD_MONTHS)
  const daysUntilExpiry = daysBetween(today, expiry)
  const monthsUntilExpiry = fullMonthsBetween(today, expiry)

  const status = resolveStatus(today, expiry)

  return {
    ...base,
    recommendedRenewalDate: toIsoDate(recommended),
    daysUntilExpiry,
    monthsUntilExpiry,
    status,
    ...describe(status),
  }
}

export function buildPassportRenewals(
  passports: RenewalPassport[] | null | undefined,
  now: Date = new Date(),
): PassportRenewal[] {
  return (passports ?? [])
    .map((passport) => buildPassportRenewal(passport, now))
    .toSorted((a, b) => {
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
      if (rank !== 0) return rank
      if (a.expiryDate && b.expiryDate && a.expiryDate !== b.expiryDate) {
        return a.expiryDate.localeCompare(b.expiryDate)
      }
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      return a.countryName.localeCompare(b.countryName)
    })
}

/** True while a passport still needs attention — drives whether the renewal
 *  notice is worth surfacing outside the passport page. */
export function needsRenewalAttention(renewal: PassportRenewal): boolean {
  return STATUS_RANK[renewal.status] <= STATUS_RANK.plan
}

function resolveStatus(today: Date, expiry: Date): PassportRenewalStatus {
  if (expiry <= today) return "expired"
  if (expiry <= shiftMonths(today, 3)) return "critical"
  if (expiry <= shiftMonths(today, VALIDITY_RULE_MONTHS)) return "urgent"
  if (expiry <= shiftMonths(today, RENEWAL_LEAD_MONTHS)) return "plan"
  return "valid"
}

function describe(status: PassportRenewalStatus): {
  tone: PassportRenewalTone
  headline: string
  detail: string
} {
  switch (status) {
    case "expired":
      return {
        tone: "danger",
        headline: "Expired",
        detail: "Renew before booking any travel.",
      }
    case "critical":
      return {
        tone: "danger",
        headline: "Renew immediately",
        detail: "Processing may not finish before this passport expires.",
      }
    case "urgent":
      return {
        tone: "warn",
        headline: "Renew now",
        detail: `Below the ${VALIDITY_RULE_MONTHS} months validity most destinations require on arrival.`,
      }
    case "plan":
      return {
        tone: "warn",
        headline: "Time to renew",
        detail: `Leaves ${PROCESSING_BUFFER_MONTHS} months for processing before the ${VALIDITY_RULE_MONTHS}-month validity rule applies.`,
      }
    default:
      return {
        tone: "good",
        headline: "Valid",
        detail: `Renewal recommended ${RENEWAL_LEAD_MONTHS} months before expiry.`,
      }
  }
}

/** Shifts by whole months, clamping to the last day when the target month is
 *  shorter (Mar 31 back nine months is Jun 30, not Jul 1). */
function shiftMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(date.getDate(), lastDay))
  return target
}

function fullMonthsBetween(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  return to.getDate() < from.getDate() ? months - 1 : months
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year!, month! - 1, day)
}

function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}
