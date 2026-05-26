// Place Photo API is temporarily disabled to eliminate Google Places
// Photo billing. Any in-flight client requests get a 410 — the browser
// then falls back to the placeholder icon rendered in the UI.
export default defineEventHandler(() => {
  throw createError({ statusCode: 410, message: "Place photos are temporarily disabled" })
})
