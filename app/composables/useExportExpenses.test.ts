/**
 * Coverage for the CSV export the expense tracker owns — issue #50.
 *
 * The composable only touches Blob/URL/document, so the browser surface is
 * stubbed here rather than pulled in through a DOM implementation: the blob
 * handed to `URL.createObjectURL` is captured and read back as text, which is
 * the whole output under test.
 */

import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "bun:test"

import { useExportExpenses } from "./useExportExpenses"

interface Download {
  csv: string
  filename: string
  revoked: boolean
}

interface FakeAnchor {
  href: string
  download: string
  click: () => void
}

interface DocumentLike {
  createElement: (tagName: string) => FakeAnchor
}

const realUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
// `document` is a DOM `Document` in the ambient types and absent at runtime
// here; swapping in a stub that only implements `createElement` means going
// through `unknown`.
const globalWithDocument = globalThis as unknown as { document?: DocumentLike }
const realDocument = globalWithDocument.document

let lastBlob: Blob | null = null
let lastAnchor: FakeAnchor | null = null
let revokedUrls: string[] = []

beforeEach(() => {
  lastBlob = null
  lastAnchor = null
  revokedUrls = []
  URL.createObjectURL = (blob: Blob) => {
    lastBlob = blob
    return "blob:fake"
  }
  URL.revokeObjectURL = (url: string) => {
    revokedUrls.push(url)
  }
  globalWithDocument.document = {
    createElement: () => {
      const anchor: FakeAnchor = { href: "", download: "", click: () => {} }
      lastAnchor = anchor
      return anchor
    },
  }
})

afterEach(() => {
  URL.createObjectURL = realUrl.create
  URL.revokeObjectURL = realUrl.revoke
  globalWithDocument.document = realDocument
})

interface ExportedExpense {
  description: string
  amount: string
  currencyCode: string
  amountInTripCurrency: string | null
  category: string
  paidAt: string | null
}

async function exportCsv(
  expenses: ExportedExpense[],
  { tripName = "Japan Trip", currencyCode = "JPY" } = {},
): Promise<Download> {
  const { downloadCsv } = useExportExpenses()
  downloadCsv(tripName, expenses, currencyCode)
  assert.ok(lastBlob, "expected a blob to be handed to URL.createObjectURL")
  return {
    csv: await lastBlob.text(),
    filename: lastAnchor?.download ?? "",
    revoked: revokedUrls.includes("blob:fake"),
  }
}

function expense(overrides: Partial<ExportedExpense> = {}): ExportedExpense {
  return {
    description: "Ramen",
    amount: "12.00",
    currencyCode: "JPY",
    amountInTripCurrency: "12.00",
    category: "food",
    paidAt: "2026-08-04",
    ...overrides,
  }
}

describe("useExportExpenses", () => {
  it("writes a header and one row per expense", async () => {
    const { csv } = await exportCsv([
      expense(),
      expense({
        description: "Taxi",
        amount: "30.00",
        amountInTripCurrency: "30.00",
      }),
    ])
    assert.deepEqual(csv.split("\n"), [
      "Description,Amount,Currency,Amount (JPY),Category,Date",
      "Ramen,12.00,JPY,12.00,food,2026-08-04",
      "Taxi,30.00,JPY,30.00,food,2026-08-04",
    ])
  })

  it("writes only the header when there is nothing to export", async () => {
    const { csv } = await exportCsv([])
    assert.equal(csv, "Description,Amount,Currency,Amount (JPY),Category,Date")
  })

  // Issue #47: `Amount` is what was actually paid, in the currency it was paid
  // in. Labelling a ¥3,200 lunch as "3200 EUR" because the trip reports in
  // euros is exactly the provenance loss the per-expense currency prevents.
  it("labels each row with the currency that row was paid in", async () => {
    const { csv } = await exportCsv(
      [
        expense({ amount: "3200", currencyCode: "JPY", amountInTripCurrency: "20.64" }),
        expense({
          description: "Kimchi",
          amount: "9000",
          currencyCode: "KRW",
          amountInTripCurrency: "6.10",
        }),
      ],
      { currencyCode: "EUR" },
    )
    assert.deepEqual(csv.split("\n"), [
      "Description,Amount,Currency,Amount (EUR),Category,Date",
      "Ramen,3200,JPY,20.64,food,2026-08-04",
      "Kimchi,9000,KRW,6.10,food,2026-08-04",
    ])
  })

  it("falls back to the paid amount when a legacy row has no projection", async () => {
    const { csv } = await exportCsv([expense({ amountInTripCurrency: null })])
    assert.match(csv, /^Ramen,12\.00,JPY,12\.00,food,2026-08-04$/m)
  })

  // RFC 4180: an unescaped comma silently shifts every later column, so a
  // description like "Dinner, drinks" used to corrupt the whole row.
  it("quotes descriptions containing a comma", async () => {
    const { csv } = await exportCsv([expense({ description: "Dinner, drinks" })])
    assert.match(csv, /^"Dinner, drinks",12\.00,JPY,12\.00,food,2026-08-04$/m)
  })

  it("doubles embedded quotes", async () => {
    const { csv } = await exportCsv([expense({ description: 'The "best" udon' })])
    assert.match(csv, /^"The ""best"" udon",/m)
  })

  it("quotes descriptions containing a newline", async () => {
    const { csv } = await exportCsv([expense({ description: "Line one\nLine two" })])
    assert.match(csv, /^"Line one\nLine two",/m)
  })

  it("leaves ordinary descriptions unquoted", async () => {
    const { csv } = await exportCsv([expense({ description: "Ramen" })])
    assert.match(csv, /^Ramen,/m)
  })

  // The date column is the raw YYYY-MM-DD stored in `paid_at`. Formatting it
  // through `new Date(...).toLocaleDateString()` shifted the calendar date into
  // the viewer's timezone — a day early for everyone west of UTC.
  it("emits the stored calendar date verbatim", async () => {
    const { csv } = await exportCsv([expense({ paidAt: "2026-01-01" })])
    assert.match(csv, /,2026-01-01$/m)
  })

  it("leaves the date column empty when no date was recorded", async () => {
    const { csv } = await exportCsv([expense({ paidAt: null })])
    assert.match(csv, /^Ramen,12\.00,JPY,12\.00,food,$/m)
  })

  it("names the trip currency in the converted column header", async () => {
    const { csv } = await exportCsv([expense()], { currencyCode: "EUR" })
    assert.match(csv, /^Description,Amount,Currency,Amount \(EUR\),Category,Date$/m)
  })

  it("slugifies the trip name into the filename", async () => {
    const { filename } = await exportCsv([expense()], { tripName: "Japan  Spring Trip" })
    assert.equal(filename, "japan-spring-trip-expenses.csv")
  })

  it("revokes the object url it created", async () => {
    const { revoked } = await exportCsv([expense()])
    assert.equal(revoked, true)
  })
})
