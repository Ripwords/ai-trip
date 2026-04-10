import { db } from "../../../../db"
import { reservations } from "../../../../db/schema"
import { uuidParamsSchema, createReservationSchema } from "../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, createReservationSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const { startDate, endDate, ...restBody } = body
  const [reservation] = await db
    .insert(reservations)
    .values({
      ...restBody,
      tripId: id,
      createdById: session.user.id,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    })
    .returning()

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "reservation_added",
    description: `Added ${body.type} reservation: ${body.name}`,
  })

  return reservation
})
