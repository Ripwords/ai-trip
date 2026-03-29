interface Expense {
  description: string;
  amount: string;
  category: string;
  paidAt: string | null;
}

export function useExportExpenses() {
  function downloadCsv(tripName: string, expenses: Expense[], currencyCode: string) {
    const header = "Description,Amount,Currency,Category,Date";
    const rows = expenses.map((e) => {
      const date = e.paidAt ? new Date(e.paidAt).toLocaleDateString() : "";
      // Escape description for CSV
      const desc = e.description.includes(",") ? `"${e.description}"` : e.description;
      return `${desc},${e.amount},${currencyCode},${e.category},${date}`;
    });

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${tripName.replace(/\s+/g, "-").toLowerCase()}-expenses.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return { downloadCsv };
}
