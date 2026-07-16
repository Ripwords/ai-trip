import { google } from "@ai-sdk/google"

/**
 * Model registry — swap models per handler without touching business logic.
 * `default` (structured planning) and `discuss` (user-facing chat + review
 * judgment) run on flash for quality; research/classification stay on
 * flash-lite for cost.
 */
export const AI_MODELS = {
  default: "gemini-3.5-flash",
  research: "gemini-3.1-flash-lite",
  classify: "gemini-3.1-flash-lite",
  discuss: "gemini-3.5-flash",
} as const

export type AIModelKey = keyof typeof AI_MODELS

export function getModel(key: AIModelKey = "default") {
  return google(AI_MODELS[key])
}
