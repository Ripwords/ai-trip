interface Expense {
  description: string
  amount: string
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
    const header = "Description,Amount,Currency,Category,Date"
    const rows = expenses.map((e) => {
      // Emit the raw YYYY-MM-DD. `new Date(...).toLocaleDateString()` shifted
      // the calendar date into the viewer's timezone (a day early west of UTC),
      // and ISO is the better CSV format for spreadsheets anyway.
      const date = e.paidAt ?? ""
      return `${escapeCsvField(e.description)},${e.amount},${currencyCode},${e.category},${date}`
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
