import { z } from "zod"
import { transportModes } from "./transport"
import { EXPENSE_CATEGORIES } from "../../shared/utils/expense-categories"
import { SPLIT_MODES } from "../../shared/utils/splits"
import {
  EXPENSE_PAGE_SIZE_DEFAULT,
  EXPENSE_PAGE_SIZE_MAX,
  EXPENSE_SORT_FIELDS,
  EXPENSE_SORT_ORDERS,
} from "../../shared/utils/expense-list"

export const uuidParamsSchema = z.object({
  id: z.string().uuid(),
})

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const tripStatusEnum = z.enum(["upcoming", "ongoing", "completed", "cancelled"])

/**
 * A decimal money amount, as a string, sized to fit the `numeric(10, 2)`
 * columns it is written to (8 integer digits + 2 decimals).
 *
 * Plain `z.string()` let `"abc"`, `"1e40"` and `""` reach Postgres, which
 * rejected them with `invalid input syntax for type numeric` / `numeric field
 * overflow` — surfacing as an unhandled 500 instead of a 400. `"-50"` was
 * worse: it persisted, and silently corrupted every total that summed it.
 */
export const moneyString = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, "Must be a positive amount with at most 2 decimal places")

// Not a strict enum — Google Places returns types like "museum", "cafe", "park", etc.
export const activityTypeEnum = z.string().min(1)

export const budgetEnum = z.enum(["budget", "moderate", "luxury"])
export const paceEnum = z.enum(["relaxed", "moderate", "packed"])
export const transportModeEnum = z.enum(transportModes)

export const tripPreferencesSchema = z.object({
  budget: budgetEnum.optional(),
  interests: z.array(z.string()).optional(),
  pace: paceEnum.optional(),
  travelStyle: z.array(z.string()).optional(),
  transportMode: transportModeEnum.optional(),
})

// Note: `.refine()` returns a `ZodEffects`, which doesn't expose `.partial()`
// — `updateTripSchema` below builds on this with `.partial().extend()`. Keep
// the cross-field date check in the POST handler instead.
export const createTripSchema = z.object({
  countryCode: z.string().length(2).toUpperCase(),
  name: z.string().min(1).max(100).nullish(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  preferences: tripPreferencesSchema.optional(),
  currencyCode: z.string().length(3).optional(),
})

export const updateTripSchema = createTripSchema
  .partial()
  // `currencyCode` is deliberately absent (and stripped if sent): setting it
  // here wrote the new code without touching a single stored amount, silently
  // reinterpreting every value at 1:1. Currency changes must go through
  // /convert-currency, which takes a row lock, checks the `from` code, and
  // converts every money column in one transaction.
  .omit({ currencyCode: true })
  .extend({
    status: tripStatusEnum.optional(),
    budget: moneyString.nullish(),
    tripNotes: z.string().nullish(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "endDate must be >= startDate",
    path: ["endDate"],
  })

export const dateRangeQuerySchema = z
  .object({
    startDate: z.string().date(),
    endDate: z.string().date(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be >= startDate",
    path: ["endDate"],
  })

export const updateActivitySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  suggestedTime: z.string().nullish(),
  estimatedDurationMinutes: z.number().int().positive().nullish(),
  costEstimate: z.string().nullish(),
  sortOrder: z.number().int().min(0).optional(),
  notes: z.string().nullish(),
  actualCost: z.string().nullish(),
})

export const activityIdParamsSchema = z.object({
  id: z.string().uuid(),
  activityId: z.string().uuid(),
})

export const reorderActivitiesSchema = z.object({
  activities: z.array(
    z.object({
      id: z.string().uuid(),
      sortOrder: z.number().int().min(0),
    }),
  ),
})

// Day params
export const dayIdParamsSchema = z.object({
  id: z.string().uuid(),
  dayId: z.string().uuid(),
})

// Place search
export const placeSearchSchema = z.object({
  query: z.string().min(1),
})

// Trip ideas
export const createIdeaSchema = z.object({
  name: z.string().min(1),
  placeId: z.string().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  address: z.string().optional(),
  rating: z.number().optional(),
  photos: z.array(z.string()).optional(),
  notes: z.string().optional(),
})

export const ideaIdParamsSchema = z.object({
  id: z.string().uuid(),
  ideaId: z.string().uuid(),
})

export const promoteIdeaSchema = z.object({
  itineraryDayId: z.string().uuid(),
  sortOrder: z.number().int().min(0).optional(),
})

// Add activity directly to a day
export const addActivitySchema = z.object({
  itineraryDayId: z.string().uuid(),
  name: z.string().min(1),
  placeId: z.string().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  address: z.string().optional(),
  rating: z.number().optional(),
  photos: z.array(z.string()).optional(),
  notes: z.string().optional(),
  costEstimate: z.string().nullish(),
})

// Checklists
export const createChecklistSchema = z.object({
  name: z.string().min(1),
})

export const updateChecklistSchema = z.object({
  name: z.string().min(1).optional(),
})

export const checklistIdParamsSchema = z.object({
  id: z.string().uuid(),
  checklistId: z.string().uuid(),
})

export const createChecklistItemSchema = z.object({
  text: z.string().min(1),
  sortOrder: z.number().int().min(0).optional(),
  category: z.string().nullish(),
})

export const updateChecklistItemSchema = z.object({
  text: z.string().min(1).optional(),
  checked: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  category: z.string().nullish(),
})

export const checklistItemIdParamsSchema = z.object({
  id: z.string().uuid(),
  checklistId: z.string().uuid(),
  itemId: z.string().uuid(),
})

// Accommodation
export const updateAccommodationSchema = z.object({
  accommodationName: z.string().nullish(),
  accommodationPlaceId: z.string().nullish(),
  accommodationAddress: z.string().nullish(),
  accommodationLat: z.number().nullish(),
  accommodationLng: z.number().nullish(),
})

export const updateAccommodationRangeSchema = updateAccommodationSchema.extend({
  dayIds: z.array(z.string().uuid()).min(1),
})

// Expenses. Categories come from shared/ so the client picker and badge map
// cannot drift from what the server accepts.
export const expenseCategoryEnum = z.enum(EXPENSE_CATEGORIES)
export const splitModeEnum = z.enum(SPLIT_MODES)

export const createExpenseSchema = z.object({
  description: z.string().min(1),
  amount: moneyString,
  category: expenseCategoryEnum.optional(),
  activityId: z.string().uuid().nullish(),
  paidById: z.string().nullish(),
  // How this expense is shared (#35). `participantIds` omitted means everyone
  // on the trip; anything else is stored resolved in `expenses.splits`.
  splitMode: splitModeEnum.optional(),
  // Duplicates must be rejected here, not deduplicated: `resolveSplits` derives
  // one weight per array entry but returns a Record keyed by user id, so a
  // repeated id collapses *after* the weights are computed. An equal split of
  // 9000 across ["a","a","b"] resolves to { a: 3000, b: 3000 } and destroys
  // 3000 minor units outright.
  participantIds: z
    .array(z.string())
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Split participants must be unique",
    })
    .optional(),
  // Non-negative, never merely finite. A $100 expense split
  // { a: 20000, b: -10000 } sums to the right total, so the reconciliation
  // check downstream passes — while booking a $200 debt to A and a $100 credit
  // to B, inventing $100 owed to whoever posted the expense. Zero is allowed:
  // "this person owes nothing for this one" is a real split.
  splitValues: z.record(z.string(), z.number().finite().nonnegative()).optional(),
  // A calendar date, not an instant — the `paid_at` column is a `date`.
  // Legacy clients may still send a full ISO timestamp; take its date part
  // rather than rejecting, since that is exactly what used to be stored.
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Must be a YYYY-MM-DD date")
    .transform((s) => s.slice(0, 10))
    .nullish(),
})

// `.partial()` alone made `{}` a valid body — an empty PUT was accepted and
// returned 200 having changed nothing. Require at least one field.
export const updateExpenseSchema = createExpenseSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" })

export const expenseIdParamsSchema = z.object({
  id: z.string().uuid(),
  expenseId: z.string().uuid(),
})

/** Receipts (#48). All three ids are checked against each other by the handler. */
export const expenseAttachmentParamsSchema = expenseIdParamsSchema.extend({
  attachmentId: z.string().uuid(),
})

/**
 * `GET /api/trips/:id/expenses` query string — issue #49.
 *
 * A form that submits an untouched `<select>` sends `?category=`, so an empty
 * string has to mean "not filtered" rather than "filter by the empty category";
 * otherwise the list 400s the moment a filter is cleared.
 */
const blankIsAbsent = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional())

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date")

export const expenseListQuerySchema = z
  .object({
    category: blankIsAbsent(expenseCategoryEnum),
    // Free-form because user ids are BetterAuth strings, not uuids, plus the
    // `"none"` sentinel for expenses with no payer recorded.
    payerId: blankIsAbsent(z.string().min(1).max(255)),
    from: blankIsAbsent(calendarDate),
    to: blankIsAbsent(calendarDate),
    sort: z.enum(EXPENSE_SORT_FIELDS).default("createdAt"),
    order: z.enum(EXPENSE_SORT_ORDERS).default("desc"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(EXPENSE_PAGE_SIZE_MAX)
      .default(EXPENSE_PAGE_SIZE_DEFAULT),
    cursor: blankIsAbsent(z.string().max(512)),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "`from` must not be after `to`",
  })

// Reservations
export const reservationTypeEnum = z.enum([
  "flight",
  "accommodation",
  "restaurant",
  "car_rental",
  "activity",
  "transport",
  "other",
])

export const reservationStatusEnum = z.enum(["confirmed", "pending", "cancelled"])

export const createReservationSchema = z.object({
  type: reservationTypeEnum,
  status: reservationStatusEnum.optional(),
  name: z.string().min(1),
  confirmationNumber: z.string().nullish(),
  provider: z.string().nullish(),
  notes: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  // Was a plain z.string(): "abc" reached Postgres as a 500 and "-50" silently
  // corrupted every total that summed it — the same defect expenses had.
  amount: moneyString.nullish(),
})

export const updateReservationSchema = createReservationSchema.partial()

/**
 * The editable surface of a *derived* booking (`source !== 'manual'`).
 *
 * Name and dates are mirrored from the stay that owns them — editing the hotel
 * or its nights happens in the itinerary, which is the source of truth. Only
 * the fields the itinerary can't know are accepted here.
 */
export const updateLinkedReservationSchema = z.object({
  status: reservationStatusEnum.optional(),
  confirmationNumber: z.string().nullish(),
  provider: z.string().nullish(),
  notes: z.string().nullish(),
  amount: moneyString.nullish(),
})

export const reservationIdParamsSchema = z.object({
  id: z.string().uuid(),
  reservationId: z.string().uuid(),
})

// Packing templates
export const createPackingTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  items: z
    .array(
      z.object({
        text: z.string().min(1),
        category: z.string().min(1),
      }),
    )
    .optional(),
})

export const packingTemplateIdParamsSchema = z.object({
  templateId: z.string().uuid(),
})

export const loadTemplateSchema = z.object({
  templateId: z.string().uuid(),
})

export const saveAsTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
})

// Activity participants
export const addParticipantSchema = z.object({
  userId: z.string().min(1),
})

export const removeParticipantParamsSchema = z.object({
  id: z.string().uuid(),
  activityId: z.string().uuid(),
  userId: z.string().min(1),
})

// Passports
export const createPassportSchema = z.object({
  countryCode: z.string().length(2).toUpperCase(),
  label: z.string().max(100).nullish(),
  passportNumber: z.string().max(20).nullish(),
  expiryDate: z.string().date().nullish(),
  isDefault: z.boolean().optional(),
})

export const updatePassportSchema = z.object({
  label: z.string().max(100).nullish(),
  passportNumber: z.string().max(20).nullish(),
  expiryDate: z.string().date().nullish(),
  isDefault: z.boolean().optional(),
})

// Flights
export const createFlightSchema = z.object({
  flightNumber: z
    .string()
    .min(3)
    .max(10)
    .transform((v) => v.toUpperCase().replace(/\s/g, "")),
  flightDate: z.string().date(),
  tripId: z.string().uuid().nullish(),
})

export const updateFlightSchema = z.object({
  tripId: z.string().uuid().nullish(),
})

// Visa check (new GET-based)
export const visaCheckQuerySchema = z.object({
  destination: z.string().length(2).toUpperCase(),
  passport: z.string().length(2).toUpperCase().optional(),
})
