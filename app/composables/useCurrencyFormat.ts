import type { MaybeRefOrGetter } from "vue"
import { ZERO_DECIMAL_CURRENCIES } from "#shared/utils/currency"

export interface FormatOptions {
  /** Drop fractional digits even for currencies that normally use them (e.g. trip-summary headline numbers). */
  compact?: boolean
}

export function useCurrencyFormat(currencyCode: MaybeRefOrGetter<string | null | undefined>) {
  const code = computed(() => {
    const raw = toValue(currencyCode)
    return (raw || "USD").toUpperCase()
  })
  const isZeroDecimal = computed(() => ZERO_DECIMAL_CURRENCIES.has(code.value))

  function digitsFor(opts?: FormatOptions): number {
    if (isZeroDecimal.value) return 0
    if (opts?.compact) return 0
    return 2
  }

  function format(amount: number | string | null | undefined, opts?: FormatOptions): string {
    if (amount == null || amount === "") return ""
    const num = typeof amount === "string" ? parseFloat(amount) : amount
    if (!Number.isFinite(num)) return ""
    const digits = digitsFor(opts)
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code.value,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(num)
  }

  function symbol(): string {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code.value,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0)
    return parts.find((p) => p.type === "currency")?.value ?? code.value
  }

  return { format, symbol, code, isZeroDecimal }
}
