/**
 * Presentation rules for the Bookings tab.
 *
 * A booking derived from the itinerary already knows its hotel and its nights,
 * so the card must prompt for the gaps only — the confirmation number, the
 * provider and what it cost — and send the user back to the itinerary for
 * anything the stay owns.
 */

/** The gap fields the server reports on `missingFields`. */
export type BookingGapField = "confirmationNumber" | "provider" | "amount"

/** Every field the reservation form can render. */
export type BookingField =
  | "type"
  | "status"
  | "name"
  | "confirmationNumber"
  | "provider"
  | "startDate"
  | "endDate"
  | "amount"
  | "notes"

export interface BookingRow {
  id: string
  type: string
  source: string
  status: string
  name: string
  confirmationNumber: string | null
  provider: string | null
  notes: string | null
  startDate: string | null
  endDate: string | null
  amount: string | null
  detachedAt: string | null
  /** First night of the linked stay, for the "Edit in itinerary" jump. */
  itineraryDayId: string | null
  missingFields: BookingGapField[]
}

const MANUAL_FIELDS: readonly BookingField[] = [
  "type",
  "status",
  "name",
  "confirmationNumber",
  "provider",
  "startDate",
  "endDate",
  "amount",
  "notes",
]

/** What a derived row's own card may edit — the rest lives in the itinerary. */
const DERIVED_FIELDS: readonly BookingField[] = [
  "status",
  "confirmationNumber",
  "provider",
  "amount",
  "notes",
]

const GAP_LABELS: Record<BookingGapField, string> = {
  confirmationNumber: "confirmation number",
  provider: "provider",
  amount: "amount",
}

/** True when the itinerary, not the user, owns this row's name and dates. */
export function isDerivedBooking(row: Pick<BookingRow, "source">): boolean {
  return row.source !== "manual"
}

/**
 * The chip explaining where a row came from. A detached row says so rather
 * than quietly passing for hand-typed — its stay went away, but its
 * confirmation number and amount did not.
 */
export function bookingOriginHint(row: Pick<BookingRow, "source" | "detachedAt">): string | null {
  if (isDerivedBooking(row)) return "From itinerary"
  if (row.detachedAt) return "No longer linked"
  return null
}

/**
 * Whether to badge a row as incomplete. Only derived rows qualify: a manual
 * booking without a confirmation number is a choice, not an omission.
 */
export function needsDetails(row: Pick<BookingRow, "source" | "missingFields">): boolean {
  return isDerivedBooking(row) && row.missingFields.length > 0
}

export function missingFieldLabel(field: BookingGapField): string {
  return GAP_LABELS[field]
}

/** e.g. `["confirmationNumber", "amount"]` → "confirmation number and amount". */
export function missingFieldsSummary(fields: readonly BookingGapField[]): string {
  const labels = fields.map(missingFieldLabel)
  if (labels.length === 0) return ""
  if (labels.length === 1) return labels[0]!
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`
}

/** Which form fields a row's card should render. */
export function editableBookingFields(
  row: Pick<BookingRow, "source" | "detachedAt">,
): BookingField[] {
  return [...(isDerivedBooking(row) ? DERIVED_FIELDS : MANUAL_FIELDS)]
}
