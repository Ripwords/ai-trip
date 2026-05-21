interface PdfActivity {
  name: string
  type: string
  address: string | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  costEstimate: string | null
  notes: string | null
}

interface PdfDay {
  dayNumber: number
  date: string
  notes: string | null
  accommodationName: string | null
  activities: PdfActivity[]
}

interface PdfReservation {
  type: string
  status: string
  name: string
  confirmationNumber: string | null
  provider: string | null
  startDate: string | null
  endDate: string | null
  amount: string | null
}

interface PdfExpense {
  description: string
  amount: string
  category: string
  paidAt: string | null
}

interface PdfTripData {
  destination: string
  startDate: string
  endDate: string
  currencyCode: string
  budget: string | null
  days: PdfDay[]
  expenses: PdfExpense[]
  reservations: PdfReservation[]
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function useExportPdf() {
  function downloadPdf(trip: PdfTripData) {
    function fmtDate(dateStr: string): string {
      return new Date(dateStr).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    }

    function fmtDateShort(dateStr: string): string {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    }

    const { format: formatCurrencyRaw } = useCurrencyFormat(trip.currencyCode)
    function formatCurrency(amount: string): string {
      return formatCurrencyRaw(amount)
    }

    function formatType(type: string): string {
      return type
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    }

    const start = new Date(trip.startDate)
    const end = new Date(trip.endDate)
    const dayCount = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

    // Build day sections
    const daySections = trip.days
      .map((day) => {
        const activityRows = day.activities
          .map(
            (a) => `
          <tr>
            <td>${esc(a.suggestedTime || "-")}</td>
            <td>
              <strong>${esc(a.name)}</strong>
              ${a.notes ? `<div class="note">${esc(a.notes)}</div>` : ""}
            </td>
            <td>${esc(a.address || "-")}</td>
            <td>${a.estimatedDurationMinutes ? `${a.estimatedDurationMinutes} min` : "-"}</td>
            <td>${a.costEstimate ? esc(formatCurrency(a.costEstimate)) : "-"}</td>
          </tr>`,
          )
          .join("")

        const activitiesTable =
          day.activities.length > 0
            ? `<table>
            <thead><tr><th>Time</th><th>Activity</th><th>Address</th><th>Duration</th><th>Cost</th></tr></thead>
            <tbody>${activityRows}</tbody>
          </table>`
            : `<p class="empty">No activities planned for this day.</p>`

        return `
        <div class="day-section">
          <div class="day-header">
            <span class="day-num">Day ${day.dayNumber}</span>
            <span class="day-date">${esc(fmtDate(day.date))}</span>
          </div>
          ${day.accommodationName ? `<p class="accommodation">🏨 ${esc(day.accommodationName)}</p>` : ""}
          ${day.notes ? `<p class="day-notes">${esc(day.notes)}</p>` : ""}
          ${activitiesTable}
        </div>`
      })
      .join("")

    // Build reservations section
    let reservationsSection = ""
    if (trip.reservations.length > 0) {
      const rows = trip.reservations
        .map((r) => {
          let dates = "-"
          if (r.startDate) {
            dates = fmtDateShort(r.startDate)
            if (r.endDate) dates += ` – ${fmtDateShort(r.endDate)}`
          }
          return `<tr>
            <td>${esc(formatType(r.type))}</td>
            <td>${esc(r.name)}</td>
            <td><span class="status-${r.status}">${esc(formatType(r.status))}</span></td>
            <td class="mono">${esc(r.confirmationNumber || "-")}</td>
            <td>${esc(dates)}</td>
            <td>${r.amount ? esc(formatCurrency(r.amount)) : "-"}</td>
          </tr>`
        })
        .join("")

      reservationsSection = `
        <div class="page-break"></div>
        <h2 class="section-title">Reservations</h2>
        <table>
          <thead><tr><th>Type</th><th>Name</th><th>Status</th><th>Confirmation #</th><th>Dates</th><th>Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
    }

    // Build budget section
    let budgetSection = ""
    if (trip.expenses.length > 0) {
      const byCategory: Record<string, number> = {}
      let total = 0
      for (const e of trip.expenses) {
        const cat = e.category || "other"
        byCategory[cat] = (byCategory[cat] ?? 0) + parseFloat(e.amount)
        total += parseFloat(e.amount)
      }

      const catRows = Object.entries(byCategory)
        .toSorted(([, a], [, b]) => b - a)
        .map(
          ([cat, amount]) => `<tr>
            <td>${esc(formatType(cat))}</td>
            <td>${esc(formatCurrency(String(amount)))}</td>
            <td>${((amount / total) * 100).toFixed(0)}%</td>
          </tr>`,
        )
        .join("")

      let budgetSummary = ""
      if (trip.budget) {
        const remaining = parseFloat(trip.budget) - total
        const isOver = remaining < 0
        budgetSummary = `
          <div class="budget-summary">
            <div><span class="label">Budget:</span> ${esc(formatCurrency(trip.budget))}</div>
            <div><span class="label">Spent:</span> ${esc(formatCurrency(String(total)))}</div>
            <div class="${isOver ? "over" : "under"}">
              <span class="label">${isOver ? "Over budget:" : "Remaining:"}</span>
              ${esc(formatCurrency(String(Math.abs(remaining))))}
            </div>
          </div>`
      }

      budgetSection = `
        <div class="page-break"></div>
        <h2 class="section-title">Budget Summary</h2>
        <table>
          <thead><tr><th>Category</th><th>Amount</th><th>% of Total</th></tr></thead>
          <tbody>
            ${catRows}
            <tr class="total-row">
              <td><strong>Total</strong></td>
              <td><strong>${esc(formatCurrency(String(total)))}</strong></td>
              <td><strong>100%</strong></td>
            </tr>
          </tbody>
        </table>
        ${budgetSummary}`
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(trip.destination)} — Itinerary</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC", "Noto Sans TC", sans-serif;
      color: #292524;
      font-size: 11px;
      line-height: 1.5;
      padding: 0;
    }
    .cover {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 90vh;
      text-align: center;
      page-break-after: always;
    }
    .cover h1 {
      font-size: 36px;
      color: #e85d3a;
      margin-bottom: 12px;
    }
    .cover .dates {
      font-size: 16px;
      color: #78716c;
      margin-bottom: 6px;
    }
    .cover .meta {
      font-size: 14px;
      color: #78716c;
    }
    .cover .footer {
      margin-top: 60px;
      font-size: 9px;
      color: #a8a29e;
    }
    .section-title {
      font-size: 18px;
      color: #e85d3a;
      margin-bottom: 12px;
      padding-top: 8px;
    }
    .day-section {
      page-break-inside: avoid;
      margin-bottom: 24px;
    }
    .day-header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 6px;
      border-bottom: 2px solid #e85d3a;
      padding-bottom: 4px;
    }
    .day-num {
      font-size: 16px;
      font-weight: 700;
      color: #e85d3a;
    }
    .day-date {
      font-size: 11px;
      color: #78716c;
    }
    .accommodation {
      font-size: 10px;
      color: #78716c;
      margin-bottom: 4px;
    }
    .day-notes {
      font-size: 10px;
      color: #57534e;
      margin-bottom: 6px;
      font-style: italic;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
      font-size: 10px;
    }
    th {
      background: #e85d3a;
      color: #fff;
      padding: 5px 8px;
      text-align: left;
      font-weight: 600;
      font-size: 9px;
    }
    td {
      padding: 5px 8px;
      border-bottom: 1px solid #e7e5e4;
      vertical-align: top;
    }
    tbody tr:nth-child(even) { background: #faf8f6; }
    .total-row td {
      border-top: 2px solid #292524;
      font-weight: 700;
    }
    .note {
      font-size: 9px;
      color: #78716c;
      margin-top: 2px;
    }
    .empty {
      font-size: 10px;
      color: #a8a29e;
      font-style: italic;
    }
    .mono { font-family: "SF Mono", "Fira Code", monospace; font-size: 9px; }
    .status-confirmed { color: #16a34a; font-weight: 600; }
    .status-pending { color: #ca8a04; font-weight: 600; }
    .status-cancelled { color: #dc2626; font-weight: 600; }
    .budget-summary {
      margin-top: 12px;
      padding: 12px;
      background: #faf8f6;
      border-radius: 8px;
      font-size: 12px;
    }
    .budget-summary .label { font-weight: 600; }
    .budget-summary .under { color: #16a34a; }
    .budget-summary .over { color: #dc2626; }
    .page-break { page-break-before: always; }
    @media print {
      body { padding: 0; }
      .cover { min-height: 100vh; }
      .no-print { display: none; }
    }
    @media screen {
      body { max-width: 800px; margin: 0 auto; padding: 40px 24px; }
      .print-bar {
        position: sticky;
        top: 0;
        background: #292524;
        color: #fff;
        padding: 10px 20px;
        margin: -40px -24px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        z-index: 10;
      }
      .print-bar button {
        background: #e85d3a;
        color: #fff;
        border: none;
        padding: 8px 20px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .print-bar button:hover { background: #d14e2e; }
    }
  </style>
</head>
<body>
  <div class="print-bar no-print">
    <span>Trip itinerary preview — use the button or Ctrl/⌘+P to save as PDF</span>
    <button onclick="window.print()">Save as PDF</button>
  </div>

  <div class="cover">
    <h1>${esc(trip.destination)}</h1>
    <div class="dates">${esc(fmtDate(trip.startDate))} — ${esc(fmtDate(trip.endDate))}</div>
    <div class="meta">${dayCount} days${trip.budget ? ` · Budget: ${esc(formatCurrency(trip.budget))}` : ""}</div>
    <div class="footer">Generated by AI Trip Planner</div>
  </div>

  <h2 class="section-title">Itinerary</h2>
  ${daySections}
  ${reservationsSection}
  ${budgetSection}
</body>
</html>`

    const printWindow = window.open("", "_blank")
    if (!printWindow) return
    printWindow.document.write(html)
    printWindow.document.close()
  }

  return { downloadPdf }
}
