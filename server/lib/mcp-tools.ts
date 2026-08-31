import type { CallToolResult, McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"

import { db } from "../db"
import { addActivitySchema, createTripSchema, uuidParamsSchema } from "../utils/schemas"
import { requireTripAccess } from "../utils/trip-access"
import { loadTripVisibility } from "./trip-visibility"
import { addActivity, createTrip } from "./trip-writes"
import { getTripWithRelations } from "./trips"

export const MCP_SCOPES = { read: "trips:read", write: "trips:write" } as const
export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES]

export interface McpToolContext {
  userId: string
}

export interface RegisteredMcpTool {
  name: string
  scope: McpScope
  register: (server: McpServer, ctx: McpToolContext) => void
}

const GENERIC_FAILURE = "The tool failed unexpectedly."

/**
 * What the caller is allowed to read about a failure. h3 errors carry a
 * `statusCode` and a message already written for a person ("Trip not found",
 * "You don't have permission to do this"); anything else is an internal fault
 * whose message could name a host, a query or a stack frame.
 */
function toolErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return GENERIC_FAILURE
  if (!("statusCode" in error) || !("message" in error)) return GENERIC_FAILURE

  const { statusCode, message } = error
  if (typeof statusCode !== "number" || typeof message !== "string") return GENERIC_FAILURE
  return message
}

export function defineMcpTool<TSchema extends z.ZodObject>(def: {
  name: string
  title: string
  description: string
  scope: McpScope
  inputSchema: TSchema
  execute: (input: z.output<TSchema>, ctx: McpToolContext) => Promise<unknown>
}): RegisteredMcpTool {
  // Widened to the concrete type on purpose: `registerTool`'s callback type is a
  // conditional over its schema parameter, which TypeScript leaves unresolved
  // while the schema is still a type variable.
  const schema: z.ZodObject = def.inputSchema

  return {
    name: def.name,
    scope: def.scope,
    register: (server, ctx) => {
      server.registerTool(
        def.name,
        { title: def.title, description: def.description, inputSchema: schema },
        async (input): Promise<CallToolResult> => {
          try {
            const result = await def.execute(def.inputSchema.parse(input), ctx)
            return { content: [{ type: "text", text: JSON.stringify(result) }] }
          } catch (error: unknown) {
            console.warn(`[mcp] tool ${def.name} failed`, error)
            return { isError: true, content: [{ type: "text", text: toolErrorMessage(error) }] }
          }
        },
      )
    },
  }
}

const tripIdSchema = z.object({ tripId: uuidParamsSchema.shape.id })

/**
 * `shareToken` mints the public `/shared/<token>` URL, so `GET /api/trips/[id]`
 * returns it to the owner only. No MCP tool returns it at all: an agent has no
 * use for it, and never emitting it removes the question.
 */
function withoutShareToken<T extends { shareToken: string | null }>(
  trip: T,
): Omit<T, "shareToken"> {
  const { shareToken: _shareToken, ...rest } = trip
  return rest
}

export const MCP_TOOLS: readonly RegisteredMcpTool[] = [
  defineMcpTool({
    name: "list_trips",
    title: "List trips",
    description:
      "List every trip the signed-in user owns or is an active member of, as a compact summary.",
    scope: MCP_SCOPES.read,
    inputSchema: z.object({}),
    execute: async (_input, ctx) => {
      const { condition } = await loadTripVisibility(ctx.userId)
      const rows = await db.query.trips.findMany({
        where: condition,
        columns: {
          id: true,
          name: true,
          destination: true,
          countryCode: true,
          startDate: true,
          endDate: true,
          status: true,
          currencyCode: true,
        },
        with: { days: { columns: { id: true } } },
        orderBy: (trip, { desc }) => [desc(trip.createdAt)],
      })

      return rows.map(({ days, ...trip }) => Object.assign(trip, { dayCount: days.length }))
    },
  }),

  defineMcpTool({
    name: "get_trip",
    title: "Get a trip",
    description:
      "Fetch one trip in full: its itinerary days, the activities on each day and the travel segments between them.",
    scope: MCP_SCOPES.read,
    inputSchema: tripIdSchema,
    execute: async (input, ctx) => {
      await requireTripAccess(input.tripId, ctx.userId)

      const trip = await getTripWithRelations(input.tripId)
      if (!trip) throw createError({ statusCode: 404, message: "Trip not found" })

      return withoutShareToken(trip)
    },
  }),

  defineMcpTool({
    name: "create_trip",
    title: "Create a trip",
    description:
      "Create a trip for the signed-in user and lay out one itinerary day per date in the range.",
    scope: MCP_SCOPES.write,
    inputSchema: createTripSchema,
    execute: async (input, ctx) => {
      const trip = await createTrip(ctx.userId, input)
      if (!trip) throw createError({ statusCode: 404, message: "Trip not found" })

      return withoutShareToken(trip)
    },
  }),

  defineMcpTool({
    name: "add_activity",
    title: "Add an activity",
    description:
      "Add an activity to one day of a trip the signed-in user owns or can edit, and recompute that day's travel segments.",
    scope: MCP_SCOPES.write,
    inputSchema: tripIdSchema.extend(addActivitySchema.shape),
    execute: async ({ tripId, ...activity }, ctx) => addActivity(ctx.userId, tripId, activity),
  }),
]
