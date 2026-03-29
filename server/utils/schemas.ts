import { z } from "zod";

export const uuidParamsSchema = z.object({
  id: z.string().uuid(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const tripStatusEnum = z.enum(["upcoming", "ongoing", "completed"]);

// Not a strict enum — Google Places returns types like "museum", "cafe", "park", etc.
export const activityTypeEnum = z.string().min(1);

export const budgetEnum = z.enum(["budget", "moderate", "luxury"]);
export const paceEnum = z.enum(["relaxed", "moderate", "packed"]);

export const tripPreferencesSchema = z.object({
  budget: budgetEnum.optional(),
  interests: z.array(z.string()).optional(),
  pace: paceEnum.optional(),
  travelStyle: z.array(z.string()).optional(),
});

export const createTripSchema = z.object({
  destination: z.string().min(1),
  startDate: z.string().date(),
  endDate: z.string().date(),
  preferences: tripPreferencesSchema.optional(),
});

export const updateTripSchema = createTripSchema.partial().extend({
  status: tripStatusEnum.optional(),
  budget: z.string().nullish(),
  currencyCode: z.string().length(3).optional(),
  tripNotes: z.string().nullish(),
});

export const updateActivitySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  suggestedTime: z.string().nullish(),
  estimatedDurationMinutes: z.number().int().positive().nullish(),
  costEstimate: z.string().nullish(),
  sortOrder: z.number().int().min(0).optional(),
  notes: z.string().nullish(),
  actualCost: z.string().nullish(),
});

export const activityIdParamsSchema = z.object({
  id: z.string().uuid(),
  activityId: z.string().uuid(),
});

export const reorderActivitiesSchema = z.object({
  activities: z.array(
    z.object({
      id: z.string().uuid(),
      sortOrder: z.number().int().min(0),
    })
  ),
});

// Day params
export const dayIdParamsSchema = z.object({
  id: z.string().uuid(),
  dayId: z.string().uuid(),
});

// Place search
export const placeSearchSchema = z.object({
  query: z.string().min(1),
});

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
});

export const ideaIdParamsSchema = z.object({
  id: z.string().uuid(),
  ideaId: z.string().uuid(),
});

export const promoteIdeaSchema = z.object({
  itineraryDayId: z.string().uuid(),
  sortOrder: z.number().int().min(0).optional(),
});

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
});

// Checklists
export const createChecklistSchema = z.object({
  name: z.string().min(1),
});

export const updateChecklistSchema = z.object({
  name: z.string().min(1).optional(),
});

export const checklistIdParamsSchema = z.object({
  id: z.string().uuid(),
  checklistId: z.string().uuid(),
});

export const createChecklistItemSchema = z.object({
  text: z.string().min(1),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateChecklistItemSchema = z.object({
  text: z.string().min(1).optional(),
  checked: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const checklistItemIdParamsSchema = z.object({
  id: z.string().uuid(),
  checklistId: z.string().uuid(),
  itemId: z.string().uuid(),
});

// Accommodation
export const updateAccommodationSchema = z.object({
  accommodationName: z.string().nullish(),
  accommodationPlaceId: z.string().nullish(),
  accommodationAddress: z.string().nullish(),
  accommodationLat: z.number().nullish(),
  accommodationLng: z.number().nullish(),
});

// Expenses
export const expenseCategoryEnum = z.enum([
  "accommodation", "food", "transport", "activity", "shopping", "other",
]);

export const createExpenseSchema = z.object({
  description: z.string().min(1),
  amount: z.string(),
  category: expenseCategoryEnum.optional(),
  activityId: z.string().uuid().nullish(),
  paidAt: z.string().nullish(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const expenseIdParamsSchema = z.object({
  id: z.string().uuid(),
  expenseId: z.string().uuid(),
});
