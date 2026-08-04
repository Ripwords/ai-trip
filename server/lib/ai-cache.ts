import { createHash } from "node:crypto"

// ── Research cache ────────────────────────────────────────────────────

/**
 * The topics the research pass actually produces different results for.
 *
 * Deliberately coarse. The research pass answers "what's good around here",
 * and the only axis that meaningfully changes its output is the broad subject
 * area — not the exact wording the traveller used.
 */
export const RESEARCH_INTENTS = [
  "accommodation",
  "nightlife",
  "outdoors",
  "shopping",
  "food",
  "attractions",
  "general",
] as const

export type ResearchIntent = (typeof RESEARCH_INTENTS)[number]

/** A short focus phrase per intent, used to steer the web-search prompt. */
export const RESEARCH_INTENT_FOCUS: Record<ResearchIntent, string> = {
  accommodation: "places to stay — hotels, guesthouses, and the neighbourhoods worth staying in",
  nightlife: "bars, live music, and nightlife",
  outdoors: "outdoor activities, nature, parks, and day hikes",
  shopping: "shopping, markets, and souvenirs",
  food: "restaurants, street food, cafes, and local specialities",
  attractions: "attractions, landmarks, museums, and sights",
  general: "",
}

/**
 * Keywords per intent. Order matters only as a tie-break; the highest hit count
 * wins, and `RESEARCH_INTENTS` puts the most specific buckets first so an
 * "accommodation" prompt that also mentions food does not drift into `food`.
 */
const INTENT_KEYWORDS: Record<Exclude<ResearchIntent, "general">, string[]> = {
  accommodation: [
    "accommodation",
    "hotel",
    "hotels",
    "hostel",
    "airbnb",
    "guesthouse",
    "ryokan",
    "resort",
    "stay",
    "staying",
    "lodging",
  ],
  nightlife: [
    "nightlife",
    "bar",
    "bars",
    "pub",
    "pubs",
    "club",
    "clubs",
    "cocktail",
    "cocktails",
    "drinks",
    "jazz",
    "izakaya",
    "live music",
  ],
  outdoors: [
    "hike",
    "hikes",
    "hiking",
    "trail",
    "trails",
    "nature",
    "outdoor",
    "outdoors",
    "beach",
    "mountain",
    "mountains",
    "cycling",
    "kayak",
    "ski",
  ],
  shopping: [
    "shopping",
    "shop",
    "shops",
    "mall",
    "market",
    "markets",
    "souvenir",
    "souvenirs",
    "boutique",
  ],
  food: [
    "food",
    "eat",
    "eating",
    "restaurant",
    "restaurants",
    "dining",
    "dinner",
    "lunch",
    "breakfast",
    "brunch",
    "cafe",
    "cafes",
    "coffee",
    "ramen",
    "sushi",
    "bakery",
    "dessert",
    "cuisine",
    "meal",
    "michelin",
  ],
  attractions: [
    "attraction",
    "attractions",
    "sightseeing",
    "sights",
    "landmark",
    "landmarks",
    "museum",
    "museums",
    "gallery",
    "galleries",
    "temple",
    "temples",
    "shrine",
    "shrines",
    "castle",
    "palace",
    "park",
    "parks",
    "garden",
    "gardens",
    "viewpoint",
    "tour",
    "things to do",
  ],
}

/**
 * Bucket a free-text prompt into one of a handful of research topics.
 *
 * The raw prompt used to be hashed into the cache key, which meant two users —
 * or one user on two days — practically never produced the same key, so the 24h
 * cache never hit (issue #31). Full-itinerary generation was the worst case: its
 * per-day prompts differ by construction (different theme, focus, avoid list).
 */
export function researchIntent(userContext?: string): ResearchIntent {
  const text = (userContext ?? "").toLowerCase()
  if (!text.trim()) return "general"

  let best: ResearchIntent = "general"
  let bestScore = 0

  for (const intent of RESEARCH_INTENTS) {
    if (intent === "general") continue
    let score = 0
    for (const keyword of INTENT_KEYWORDS[intent]) {
      // Word-boundary match so "bar" does not fire on "barcelona".
      const pattern = new RegExp(`(?:^|[^a-z])${keyword.replace(/ /g, "\\s+")}(?![a-z])`, "g")
      score += (text.match(pattern) ?? []).length
    }
    if (score > bestScore) {
      bestScore = score
      best = intent
    }
  }

  return best
}

/**
 * Collapse a destination to the city/country it belongs to.
 *
 * Callers pass `dayLocation`, which is often a per-day street address, so the
 * destination half of the key varied per day too. Segments containing digits are
 * street numbers, building numbers, or postcodes — dropping them and keeping the
 * last two segments reduces "1-1 Yoyogikamizonocho, Shibuya City, Tokyo
 * 151-8557, Japan" to "tokyo, japan".
 */
export function normalizeResearchDestination(destination: string): string {
  const raw = destination.toLowerCase().trim()
  if (!raw) return ""

  const segments = raw
    .split(",")
    .map((s) =>
      s
        .replace(/\d+/g, " ")
        .replace(/[^\p{L}\p{M}\s]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    // A segment with no letters left was a house number or a postcode.
    .filter((s) => /\p{L}/u.test(s))

  if (segments.length === 0) return raw
  return segments.slice(-2).join(", ")
}

/**
 * Cache key for the web-research pass: a readable city slug, a short hash of the
 * normalized city, and a coarse intent bucket.
 *
 * The hash carries the city identity — the slug alone would collapse every
 * non-latin destination ("東京, 日本") to the same empty string. No raw user text
 * appears in the key: the intent is one of a fixed set of literals.
 */
export function researchCacheKey(destination: string, userContext?: string): string {
  const city = normalizeResearchDestination(destination)
  const slug = city
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
  const hash = createHash("sha256").update(city).digest("hex").slice(0, 12)
  return `${slug ? `${slug}-` : ""}${hash}-${researchIntent(userContext)}`
}

// ── Layover tips cache ────────────────────────────────────────────────

export type TimeOfDayBucket = "night" | "morning" | "afternoon" | "evening" | "unknown"

/**
 * Coarse arrival-time bucket for the layover-tips cache key and prompt.
 *
 * The hour is read off the ISO string textually when it carries no timezone
 * designator: an arrival time is a LOCAL airport clock time, so interpreting it
 * in the server's timezone (as `new Date(...).getHours()` does) would move a 3am
 * arrival into a different bucket depending on the deploy region.
 */
export function timeOfDayBucket(arrivalTime: string | null | undefined): TimeOfDayBucket {
  if (!arrivalTime) return "unknown"

  let hour: number | null = null

  const bareLocal = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):\d{2}/.exec(arrivalTime)
  if (bareLocal && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(arrivalTime)) {
    hour = Number(bareLocal[1])
  } else {
    const parsed = new Date(arrivalTime)
    if (!Number.isNaN(parsed.getTime())) hour = parsed.getHours()
  }

  if (hour === null || !Number.isFinite(hour) || hour < 0 || hour > 23) return "unknown"
  if (hour < 6) return "night"
  if (hour < 12) return "morning"
  if (hour < 18) return "afternoon"
  return "evening"
}

/**
 * Cache key for layover tips.
 *
 * `timeOfDay` is part of the key on purpose: the prompt feeds it to the model and
 * the whole `returnBy` / opening-hours answer depends on it, so a 3am arrival must
 * not be served the cached noon answer (issue #15). It is a coarse bucket rather
 * than a clock time so the key still hits for two travellers on the same flight.
 */
export function layoverTipsCacheKey(
  airport: string,
  durationHours: number,
  visaStatus: string,
  timeOfDay: string,
): string {
  return [
    airport.toLowerCase().trim(),
    durationHours,
    visaStatus.toLowerCase().trim(),
    timeOfDay.toLowerCase().trim(),
  ].join(":")
}

/** Never cache failed or sanitization-dropped research (empty string). */
export function isCacheableResearch(value: unknown): boolean {
  return typeof value === "string" && value.length > 0
}
