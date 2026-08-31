import "zod/compile"
import { z } from "zod"
import { uuidParamsSchema } from "../../../../utils/schemas"
import { recordProposalState } from "../../../../lib/trip-chat"

/**
 * Dismissals only, deliberately.
 *
 * An apply is recorded by the apply route itself, which is the only place that
 * can read the day's version at the instant of the write — the watermark the
 * supersession check depends on. Accepting "applied" here would let a client
 * stamp an Applied receipt (and, with it, an Undo offer) on a proposal that was
 * never applied to anything. Dismissal is inert by comparison: it hides a card
 * in the dismisser's own transcript and nothing else.
 */
const bodySchema = z.object({
  messageId: z.string().uuid(),
  proposalId: z.string().min(1).max(200),
  state: z.literal("dismissed"),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const { messageId, proposalId, state } = await readValidatedBody(event, bodySchema.parse)

  // No role requirement, matching GET /chat: a viewer cannot start a discuss
  // turn, but one who was demoted still owns the transcript they made. The
  // write is scoped to (trip_id, user_id, message id) inside the store, so
  // trip access alone never reaches a co-traveller's row.
  await requireTripAccess(id, session.user.id)

  const result = await recordProposalState({
    tripId: id,
    userId: session.user.id,
    messageId,
    proposalId,
    state,
  })

  if (!result.recorded) {
    if (result.reason === "error") {
      throw createError({ statusCode: 500, message: "Couldn't save that" })
    }
    // Either the message is not this user's, not on this trip, or the proposal
    // is not on that message. All three are "no such card for you".
    throw createError({ statusCode: 404, message: "Proposal not found" })
  }

  return { success: true }
})
