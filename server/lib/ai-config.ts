import { google } from "@ai-sdk/google";

/**
 * Model registry — swap models per handler without touching business logic.
 * All default to flash-lite for minimal cost. Override specific keys
 * to promote handlers to smarter models when needed.
 */
export const AI_MODELS = {
  default: "gemini-3.1-flash-lite-preview",
  research: "gemini-3.1-flash-lite-preview",
  classify: "gemini-3.1-flash-lite-preview",
} as const;

export type AIModelKey = keyof typeof AI_MODELS;

export function getModel(key: AIModelKey = "default") {
  return google(AI_MODELS[key]);
}
