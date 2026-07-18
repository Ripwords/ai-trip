import { deepseek } from "@ai-sdk/deepseek"
import { google } from "@ai-sdk/google"

interface ModelEntry {
  provider: "google" | "deepseek"
  model: string
}

/**
 * Model registry — swap models per handler without touching business logic.
 *
 * `default` and `discuss` run on Gemini 3.5 Flash. DeepSeek V4 Flash was tried
 * for cost but reverted: it is markedly slower for the interactive discuss chat
 * (buffered/laggy streaming) and for `generateObject` latency (the structured
 * `routeReasoning`-first schemas made the "optimize/fill" calls feel like a
 * hang). To re-enable after validating DeepSeek's speed + structured-output
 * reliability, flip a provider back to `"deepseek"` — the getModel branch and
 * the DEEPSEEK_API_KEY fallback below are still wired.
 *
 * `research`/`classify` stay on Gemini flash-lite because grounding
 * (`google.tools.googleSearch`) is attached to `research` and only works on
 * Gemini models.
 */
export const AI_MODELS = {
  default: { provider: "google", model: "gemini-3.5-flash" },
  research: { provider: "google", model: "gemini-3.1-flash-lite" },
  classify: { provider: "google", model: "gemini-3.1-flash-lite" },
  discuss: { provider: "google", model: "gemini-3.5-flash" },
} as const satisfies Record<string, ModelEntry>

export type AIModelKey = keyof typeof AI_MODELS

/** Gemini model used when DEEPSEEK_API_KEY is missing (previous default). */
const DEEPSEEK_FALLBACK_MODEL = "gemini-3.5-flash"

let warnedMissingDeepSeekKey = false

export function getModel(key: AIModelKey = "default") {
  const entry: ModelEntry = AI_MODELS[key]
  if (entry.provider === "deepseek") {
    if (!process.env.DEEPSEEK_API_KEY) {
      if (!warnedMissingDeepSeekKey) {
        warnedMissingDeepSeekKey = true
        console.warn(
          `[ai-config] DEEPSEEK_API_KEY is not set — falling back to ${DEEPSEEK_FALLBACK_MODEL} for DeepSeek-routed model keys`,
        )
      }
      return google(DEEPSEEK_FALLBACK_MODEL)
    }
    return deepseek(entry.model)
  }
  return google(entry.model)
}
