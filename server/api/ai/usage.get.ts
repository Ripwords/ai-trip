export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  return getAiUsage(session.user.id)
})
