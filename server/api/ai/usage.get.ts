import { thinkingAvailable } from "../../lib/ai-config"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const usage = await getAiUsage(session.user.id)
  // The client cannot see DEEPSEEK_API_KEY, and a toggle that silently does
  // nothing (Gemini fallback) is worse than no toggle at all.
  return { ...usage, thinkingAvailable: thinkingAvailable() }
})
