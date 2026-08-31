import "zod/compile"
import { z } from "zod"
import { softRemoveTripMember } from "../../../../lib/trip-members"

const paramsSchema = z.object({
  id: z.string().uuid(),
  memberId: z.string().uuid(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, memberId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // Only owner can remove members
  await requireTripAccess(id, session.user.id, ["owner"])

  return softRemoveTripMember({
    tripId: id,
    tripMemberId: memberId,
    removerUserId: session.user.id,
  })
})
