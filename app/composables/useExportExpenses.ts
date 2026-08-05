interface Expense {
  description: string
  /** What was actually paid, in `currencyCode`. */
  amount: string
  currencyCode: string
  /** The trip-currency projection; null on rows written before #47. */
  amountInTripCurrency: string | null
  category: string
  paidAt: string | null
}

function escapeCsvField(value: string): string {
  // RFC 4180: if the field contains comma, quote, or newline, wrap in quotes and double any quotes
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function useExportExpenses() {
  function downloadCsv(tripName: string, expenses: Expense[], currencyCode: string) {
    // `Amount`/`Currency` are what was actually paid; the trip-currency column
    // is the derived view. This used to stamp the *trip's* currency onto every
    // row's amount, which mislabelled every expense paid in anything else.
    const header = `Description,Amount,Currency,Amount (${currencyCode}),Category,Date`
    const rows = expenses.map((e) => {
      // Emit the raw YYYY-MM-DD. `new Date(...).toLocaleDateString()` shifted
      // the calendar date into the viewer's timezone (a day early west of UTC),
      // and ISO is the better CSV format for spreadsheets anyway.
      const date = e.paidAt ?? ""
      // A row written before per-expense currencies existed was stored in the
      // trip's currency by definition, so its amount is its own projection.
      const converted = e.amountInTripCurrency ?? e.amount
      return `${escapeCsvField(e.description)},${e.amount},${e.currencyCode},${converted},${e.category},${date}`
    })

    const csv = [header, ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)

    const link = document.createElement("a")
    link.href = url
    link.download = `${tripName.replace(/\s+/g, "-").toLowerCase()}-expenses.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return { downloadCsv }
}
