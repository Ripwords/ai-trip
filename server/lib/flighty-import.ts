export class FlightyImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FlightyImportError"
  }
}

export interface ParsedFlightyRow {
  line: number
  flightNumber: string
  flightDate: string
  airline: string
  departureAirport: string
  arrivalAirport: string
  departureTime: Date | null
  arrivalTime: Date | null
  terminal: string | null
  gate: string | null
  status: "scheduled" | "landed" | "cancelled"
}

export interface FlightyParseResult {
  rows: ParsedFlightyRow[]
  errors: { line: number; reason: string }[]
}

const REQUIRED_HEADERS = ["Date", "Airline", "Flight", "From", "To"] as const

function tokenizeCsvLine(line: string): string[] {
  const out: string[] = []
  let i = 0
  let cur = ""
  let inQuotes = false
  while (i < line.length) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cur += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ",") {
      out.push(cur)
      cur = ""
      i++
      continue
    }
    cur += ch
    i++
  }
  out.push(cur)
  return out
}

function splitCsvRows(input: string): string[] {
  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const rows: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"') {
      inQuotes = !inQuotes
      cur += ch
      continue
    }
    if (ch === "\n" && !inQuotes) {
      rows.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  if (cur.length > 0) rows.push(cur)
  return rows
}

function parseDateOrNull(value: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function parseFlightyCsv(input: string, today: Date): FlightyParseResult {
  const allLines = splitCsvRows(input)
  if (allLines.length === 0) {
    throw new FlightyImportError("This doesn't look like a Flighty export.")
  }
  const headerLine = allLines[0]!
  const headers = tokenizeCsvLine(headerLine).map((h) => h.trim())
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      throw new FlightyImportError("This doesn't look like a Flighty export.")
    }
  }
  const colIndex = (name: string) => headers.indexOf(name)
  const idx = {
    date: colIndex("Date"),
    airline: colIndex("Airline"),
    flight: colIndex("Flight"),
    from: colIndex("From"),
    to: colIndex("To"),
    depTerminal: colIndex("Dep Terminal"),
    depGate: colIndex("Dep Gate"),
    canceled: colIndex("Canceled"),
    gateDepScheduled: colIndex("Gate Departure (Scheduled)"),
    gateDepActual: colIndex("Gate Departure (Actual)"),
    gateArrScheduled: colIndex("Gate Arrival (Scheduled)"),
    gateArrActual: colIndex("Gate Arrival (Actual)"),
  }

  const todayIso = isoDate(today)
  const rows: ParsedFlightyRow[] = []
  const errors: { line: number; reason: string }[] = []

  for (let i = 1; i < allLines.length; i++) {
    const raw = allLines[i]!
    if (!raw.trim()) continue
    const lineNum = i + 1
    const cells = tokenizeCsvLine(raw).map((c) => c.trim())

    const date = cells[idx.date] ?? ""
    const airline = cells[idx.airline] ?? ""
    const flight = cells[idx.flight] ?? ""
    const from = cells[idx.from] ?? ""
    const to = cells[idx.to] ?? ""
    if (!date || !airline || !flight || !from || !to) {
      errors.push({
        line: lineNum,
        reason: "Missing required field (Date, Airline, Flight, From, or To)",
      })
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push({ line: lineNum, reason: `Invalid date: ${date}` })
      continue
    }

    const canceled = (cells[idx.canceled] ?? "").toLowerCase() === "true"
    const status: ParsedFlightyRow["status"] = canceled
      ? "cancelled"
      : date < todayIso
        ? "landed"
        : "scheduled"

    const depActual = idx.gateDepActual >= 0 ? (cells[idx.gateDepActual] ?? "") : ""
    const depScheduled = idx.gateDepScheduled >= 0 ? (cells[idx.gateDepScheduled] ?? "") : ""
    const arrActual = idx.gateArrActual >= 0 ? (cells[idx.gateArrActual] ?? "") : ""
    const arrScheduled = idx.gateArrScheduled >= 0 ? (cells[idx.gateArrScheduled] ?? "") : ""

    rows.push({
      line: lineNum,
      flightNumber: `${airline}${flight}`.toUpperCase().replace(/\s/g, ""),
      flightDate: date,
      airline,
      departureAirport: from.toUpperCase(),
      arrivalAirport: to.toUpperCase(),
      departureTime: parseDateOrNull(depActual || depScheduled),
      arrivalTime: parseDateOrNull(arrActual || arrScheduled),
      terminal: idx.depTerminal >= 0 ? cells[idx.depTerminal] || null : null,
      gate: idx.depGate >= 0 ? cells[idx.depGate] || null : null,
      status,
    })
  }

  return { rows, errors }
}
