import { z } from "zod"

export const uuidParamsSchema = z.object({
  id: z.string().uuid(),
})

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const tripStatusEnum = z.enum(["upcoming", "ongoing", "completed"])

// Not a strict enum — Google Places returns types like "museum", "cafe", "park", etc.
export const activityTypeEnum = z.string().min(1)

export const budgetEnum = z.enum(["budget", "moderate", "luxury"])
export const paceEnum = z.enum(["relaxed", "moderate", "packed"])

export const tripPreferencesSchema = z.object({
  budget: budgetEnum.optional(),
  interests: z.array(z.string()).optional(),
  pace: paceEnum.optional(),
  travelStyle: z.array(z.string()).optional(),
})

export const createTripSchema = z.object({
  destination: z.string().min(1),
  startDate: z.string().date(),
  endDate: z.string().date(),
  preferences: tripPreferencesSchema.optional(),
  currencyCode: z.string().length(3).optional(),
})

export const updateTripSchema = createTripSchema
  .partial()
  .extend({
    status: tripStatusEnum.optional(),
    budget: z.string().nullish(),
    currencyCode: z.string().length(3).optional(),
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

// Expenses
export const expenseCategoryEnum = z.enum([
  "accommodation",
  "food",
  "transport",
  "activity",
  "shopping",
  "other",
])

export const createExpenseSchema = z.object({
  description: z.string().min(1),
  amount: z.string(),
  category: expenseCategoryEnum.optional(),
  activityId: z.string().uuid().nullish(),
  paidById: z.string().nullish(),
  paidAt: z.string().nullish(),
})

export const updateExpenseSchema = createExpenseSchema.partial()

export const expenseIdParamsSchema = z.object({
  id: z.string().uuid(),
  expenseId: z.string().uuid(),
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
  amount: z.string().nullish(),
})

export const updateReservationSchema = createReservationSchema.partial()

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

// Documents
export const documentIdParamsSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
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
