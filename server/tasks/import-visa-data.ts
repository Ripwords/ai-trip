import { db } from "../db"
import { visaRequirements } from "../db/schema"
import { sql } from "drizzle-orm"

const DATASET_URL =
  "https://raw.githubusercontent.com/ilyankou/passport-index-dataset/master/passport-index-tidy.csv"

interface VisaRow {
  passportCountry: string
  destinationCountry: string
  visaStatus: string
  maxStayDays: number | null
}

function normalizeStatus(raw: string): { visaStatus: string; maxStayDays: number | null } {
  const trimmed = raw.trim().toLowerCase()

  // Numeric values = visa-free with that many days
  const num = parseInt(trimmed, 10)
  if (!isNaN(num) && num > 0) {
    return { visaStatus: "visa-free", maxStayDays: num }
  }

  if (trimmed === "-1" || trimmed === "visa required") {
    return { visaStatus: "visa-required", maxStayDays: null }
  }

  if (trimmed === "visa free" || trimmed === "vf") {
    return { visaStatus: "visa-free", maxStayDays: null }
  }

  if (trimmed === "visa on arrival" || trimmed === "voa") {
    return { visaStatus: "visa-on-arrival", maxStayDays: null }
  }

  if (trimmed === "e-visa" || trimmed === "eta" || trimmed === "evisa") {
    return { visaStatus: "evisa", maxStayDays: null }
  }

  // Fallback: treat unknown as visa-required
  return { visaStatus: "visa-required", maxStayDays: null }
}

function parseCsv(text: string): VisaRow[] {
  const lines = text.split("\n")
  const header = lines[0]
  if (!header) return []

  const cols = header.split(",").map((c) => c.trim())
  const passportIdx = cols.indexOf("Passport")
  const destinationIdx = cols.indexOf("Destination")
  const valueIdx = cols.indexOf("Value")

  if (passportIdx === -1 || destinationIdx === -1 || valueIdx === -1) {
    throw new Error(
      `Unexpected CSV headers: ${cols.join(", ")}. Expected: Passport, Destination, Value`,
    )
  }

  const rows: VisaRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue

    const parts = line.split(",")
    const passport = parts[passportIdx]?.trim()
    const destination = parts[destinationIdx]?.trim()
    const value = parts[valueIdx]?.trim()

    if (!passport || !destination || !value) continue
    // Skip self-referencing entries
    if (passport === destination) continue

    const { visaStatus, maxStayDays } = normalizeStatus(value)
    rows.push({
      passportCountry: passport,
      destinationCountry: destination,
      visaStatus,
      maxStayDays,
    })
  }

  return rows
}

export default defineTask({
  meta: {
    name: "import-visa-data",
    description: "Import visa requirements from the Passport Index Dataset",
  },
  async run() {
    console.log("Fetching Passport Index Dataset...")
    const response = await fetch(DATASET_URL)
    if (!response.ok) {
      throw new Error(`Failed to fetch dataset: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    const rows = parseCsv(text)
    console.log(`Parsed ${rows.length} visa requirement entries`)

    // Upsert in batches of 500
    const BATCH_SIZE = 500
    let upserted = 0

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      await db
        .insert(visaRequirements)
        .values(
          batch.map((r) => ({
            passportCountry: r.passportCountry,
            destinationCountry: r.destinationCountry,
            visaStatus: r.visaStatus,
            maxStayDays: r.maxStayDays,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [visaRequirements.passportCountry, visaRequirements.destinationCountry],
          set: {
            visaStatus: sql`excluded.visa_status`,
            maxStayDays: sql`excluded.max_stay_days`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
      upserted += batch.length
    }

    console.log(`Upserted ${upserted} visa requirement entries`)
    return { result: { imported: upserted } }
  },
})
