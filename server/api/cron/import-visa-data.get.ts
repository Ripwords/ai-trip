export default defineEventHandler(async (event) => {
  // Verify Vercel cron secret
  const authHeader = getHeader(event, "authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    throw createError({ statusCode: 401, message: "Unauthorized" })
  }

  const { result } = await runTask("import-visa-data")
  return { ok: true, result }
})
