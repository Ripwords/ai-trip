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
  /** The stay this row mirrors, or null once it has been unlinked. */
  stayId: string | null
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

/**
 * True when the itinerary, not the user, owns this row's name and dates.
 *
 * Both halves matter. `reservations.stay_id` is `ON DELETE SET NULL`, so a stay
 * removed by anything other than `reconcileTripStays` leaves `source = 'stay'`
 * behind with no stay to point at. Keying on `source` alone made that row
 * permanently uneditable: the card hid the fields the stay owns, and the PUT
 * 409'd on them — for a stay that no longer exists. No stay, no owner.
 */
export function isDerivedBooking(row: Pick<BookingRow, "source" | "stayId">): boolean {
  return row.source !== "manual" && row.stayId !== null
}

/**
 * The chip explaining where a row came from. A detached row says so rather
 * than quietly passing for hand-typed — its stay went away, but its
 * confirmation number and amount did not.
 */
export function bookingOriginHint(
  row: Pick<BookingRow, "source" | "stayId" | "detachedAt">,
): string | null {
  if (isDerivedBooking(row)) return "From itinerary"
  if (row.detachedAt) return "No longer linked"
  return null
}

/**
 * Whether to badge a row as incomplete. Only derived rows qualify: a manual
 * booking without a confirmation number is a choice, not an omission.
 */
export function needsDetails(
  row: Pick<BookingRow, "source" | "stayId" | "missingFields">,
): boolean {
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
  row: Pick<BookingRow, "source" | "stayId" | "detachedAt">,
): BookingField[] {
  return [...(isDerivedBooking(row) ? DERIVED_FIELDS : MANUAL_FIELDS)]
}

/** Raw form state, as the inputs hold it — all strings, dates `datetime-local`. */
export interface BookingFormValues {
  type: string
  status: string
  name: string
  confirmationNumber: string
  provider: string
  notes: string
  startDate: string
  endDate: string
  amount: string
}

/**
 * The request body for a booking form submit.
 *
 * Only the fields the row actually owns are sent: a derived row that posted its
 * mirrored name or dates is rejected with a 409, because those belong to the
 * stay and are changed in the itinerary. `row` is null when adding a new
 * booking, which is always manual.
 */
export function buildBookingBody(
  values: BookingFormValues,
  row: Pick<BookingRow, "source" | "stayId" | "detachedAt"> | null,
): Record<string, unknown> {
  // Empty optional inputs are omitted rather than sent as "", which the money
  // and date validators would reject.
  const blank = (value: string) => (value === "" ? undefined : value)
  const instant = (value: string) => (value === "" ? undefined : new Date(value).toISOString())

  const all: Record<BookingField, unknown> = {
    type: values.type,
    status: values.status,
    name: values.name,
    confirmationNumber: blank(values.confirmationNumber),
    provider: blank(values.provider),
    notes: blank(values.notes),
    startDate: instant(values.startDate),
    endDate: instant(values.endDate),
    amount: blank(values.amount),
  }

  const fields = row ? editableBookingFields(row) : [...MANUAL_FIELDS]
  const body: Record<string, unknown> = {}
  for (const field of fields) {
    body[field] = all[field]
  }
  return body
}
