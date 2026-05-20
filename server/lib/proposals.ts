import { z } from "zod"

const aiActivityPayloadSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string(),
  suggestedTime: z.string(),
  estimatedDurationMinutes: z.number().int().positive(),
  costEstimate: z.number().min(0),
  tags: z.array(z.string()),
  // Optional enrichment fields — present when the agent has already resolved a place.
  placeId: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  address: z.string().nullable().optional(),
})

const baseProposal = z.object({
  id: z.string().uuid(),
  dayId: z.string().uuid(),
  summary: z.string().min(1),
})

export const proposalSchema = z.discriminatedUnion("kind", [
  baseProposal.extend({
    kind: z.literal("add-activities"),
    payload: z.object({ activities: z.array(aiActivityPayloadSchema).min(1) }),
  }),
  baseProposal.extend({
    kind: z.literal("remove-activities"),
    payload: z.object({ activityIds: z.array(z.string().uuid()).min(1) }),
  }),
  baseProposal.extend({
    kind: z.literal("reschedule"),
    payload: z.object({
      updates: z
        .array(
          z.object({
            activityId: z.string().uuid(),
            suggestedTime: z.string().regex(/^\d{2}:\d{2}$/),
            estimatedDurationMinutes: z.number().int().positive(),
          }),
        )
        .min(1),
    }),
  }),
  baseProposal.extend({
    kind: z.literal("optimize-route"),
    payload: z.object({ orderedActivityIds: z.array(z.string().uuid()).optional() }),
  }),
  baseProposal.extend({
    kind: z.literal("set-accommodation"),
    payload: z.object({
      name: z.string(),
      address: z.string().nullable(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      placeId: z.string().nullable(),
    }),
  }),
])

export type Proposal = z.infer<typeof proposalSchema>
export type ProposalKind = Proposal["kind"]
