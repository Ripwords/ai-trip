// Place Photo API is temporarily disabled to eliminate Google Places
// Photo billing. Shared trip viewers see the placeholder icon instead.
export default defineEventHandler(() => {
  throw createError({ statusCode: 410, message: "Place photos are temporarily disabled" })
})
