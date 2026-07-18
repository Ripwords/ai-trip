import { deepseek } from "@ai-sdk/deepseek"
import { google } from "@ai-sdk/google"

interface ModelEntry {
  provider: "google" | "deepseek"
  model: string
}

/**
 * Model registry — swap models per handler without touching business logic.
 *
 * `default` and `discuss` run on DeepSeek V4 Flash in NON-THINKING mode (see
 * AI_PROVIDER_OPTIONS — the thinking default is ~8x slower and breaks streaming
 * + tool round-trips). They fall back to Gemini 3.5 Flash when DEEPSEEK_API_KEY
 * is unset (see getModel). To revert entirely to Gemini, flip these two
 * providers back to `"google"` / `"gemini-3.5-flash"`.
 *
 * `research`/`classify` stay on Gemini flash-lite because grounding
 * (`google.tools.googleSearch`) is attached to `research` and only works on
 * Gemini models.
 */
export const AI_MODELS = {
  default: { provider: "deepseek", model: "deepseek-v4-flash" },
  research: { provider: "google", model: "gemini-3.1-flash-lite" },
  classify: { provider: "google", model: "gemini-3.1-flash-lite" },
  discuss: { provider: "deepseek", model: "deepseek-v4-flash" },
} as const satisfies Record<string, ModelEntry>

export type AIModelKey = keyof typeof AI_MODELS

/**
 * Provider options passed alongside every model call. DeepSeek V4 models
 * default to THINKING mode — a hidden reasoning_content phase that makes calls
 * slow, hides output from the stream, and breaks multi-turn tool-calling. We
 * force it off. The option is namespaced under `deepseek`, so the Google
 * provider ignores it entirely — this is a no-op whenever the active model is
 * Gemini, and only takes effect once a model key is routed to DeepSeek.
 */
export const AI_PROVIDER_OPTIONS = {
  deepseek: { thinking: { type: "disabled" } },
}

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
