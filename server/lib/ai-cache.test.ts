import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const {
  researchCacheKey,
  researchSearchLocation,
  isCacheableResearch,
  timeOfDayBucket,
  layoverTipsCacheKey,
  formatLayoverDuration,
  researchIntent,
  normalizeResearchDestination,
} = await import("./ai-cache")

/**
 * The address formats production actually sees, plus the free-text destinations
 * `trips.destination` holds (a user-typed trip name, or a country name).
 *
 * The previous "keep the last two comma segments after stripping digits" rule
 * was tuned on the Japanese row alone. Everything else in this table either
 * collapsed to a shared key (the US rows all became "ca, usa") or survived as
 * per-postcode nonsense (the UK row became "london sw a aa, uk").
 */
const DESTINATIONS = {
  usMountainView: "1600 Amphitheatre Parkway, Mountain View, CA 94043, USA",
  usSanFrancisco: "123 Market St, San Francisco, CA 94103, USA",
  usSanDiego: "1 Infinite Loop, San Diego, CA 92101, USA",
  uk: "10 Downing St, London SW1A 2AA, UK",
  italy: "Via Roma 1, 00184 Roma RM, Italy",
  japan: "1-1 Yoyogikamizonocho, Shibuya City, Tokyo 151-8557, Japan",
  japan2: "2-8-1 Nishishinjuku, Shinjuku City, Tokyo 163-8001, Japan",
  canada: "301 Front St W, Toronto, ON M5V 2T6, Canada",
} as const

describe("researchCacheKey", () => {
  it("is stable for the same destination and context", () => {
    assert.equal(
      researchCacheKey({ destination: "Tokyo, Japan", countryCode: "JP" }, "ramen spots"),
      researchCacheKey({ destination: "Tokyo, Japan", countryCode: "JP" }, "ramen spots"),
    )
  })

  it("normalizes case and whitespace", () => {
    assert.equal(
      researchCacheKey({ destination: "  Tokyo,   Japan ", countryCode: "jp" }, "Ramen Spots"),
      researchCacheKey({ destination: "tokyo, japan", countryCode: "JP" }, "ramen spots"),
    )
  })

  it("differs when the context differs", () => {
    assert.notEqual(
      researchCacheKey({ destination: "Tokyo, Japan" }, "ramen spots"),
      researchCacheKey({ destination: "Tokyo, Japan" }, "jazz bars"),
    )
  })

  it("contains no raw user text and only storage-safe characters", () => {
    const key = researchCacheKey({ destination: "Tokyo, Japan" }, "IGNORE ALL <instructions>://?")
    assert.ok(!/ignore all/i.test(key))
    assert.match(key, /^[a-z0-9-]+$/)
  })

  it("keeps the key storage-safe for a destination full of punctuation", () => {
    const key = researchCacheKey({ destination: '"><script>, 東京 / 日本' }, "food")
    assert.match(key, /^[a-z0-9-]+$/)
  })

  it("separates same-named cities in different countries", () => {
    assert.notEqual(
      researchCacheKey({ destination: "Paris", countryCode: "FR" }, "food"),
      researchCacheKey({ destination: "Paris", countryCode: "US" }, "food"),
    )
  })
})

describe("researchCacheKey never collapses distinct destinations (blocker: issue #31 regression)", () => {
  it("gives every distinct address its own key", () => {
    const keys = Object.values(DESTINATIONS).map((destination) =>
      researchCacheKey({ destination }, "food"),
    )
    assert.equal(
      new Set(keys).size,
      keys.length,
      `distinct destinations shared a cache key: ${JSON.stringify(keys)}`,
    )
  })

  it("does not merge three different US cities that share a state and country", () => {
    const mv = researchCacheKey(
      { destination: DESTINATIONS.usMountainView, countryCode: "US" },
      "food",
    )
    const sf = researchCacheKey(
      { destination: DESTINATIONS.usSanFrancisco, countryCode: "US" },
      "food",
    )
    const sd = researchCacheKey({ destination: DESTINATIONS.usSanDiego, countryCode: "US" }, "food")
    assert.notEqual(mv, sf)
    assert.notEqual(sf, sd)
    assert.notEqual(mv, sd)
  })

  it("does not merge two different Tokyo street addresses", () => {
    assert.notEqual(
      researchCacheKey({ destination: DESTINATIONS.japan, countryCode: "JP" }, "ramen"),
      researchCacheKey({ destination: DESTINATIONS.japan2, countryCode: "JP" }, "ramen"),
    )
  })

  it("hits across differently-worded prompts with the same intent", () => {
    // This is the #31 win, and it survives without any address parsing: within a
    // trip the destination string is constant (`trips.destination`), so every
    // day's differently-worded prompt lands on one key.
    assert.equal(
      researchCacheKey(
        { destination: "Tokyo, Japan", countryCode: "JP" },
        "find a great dinner spot for day 2",
      ),
      researchCacheKey(
        { destination: "Tokyo, Japan", countryCode: "JP" },
        "somewhere authentic to eat on our last night",
      ),
    )
  })

  it("still misses across different cities and different intents", () => {
    assert.notEqual(
      researchCacheKey({ destination: "Tokyo, Japan" }, "ramen spots"),
      researchCacheKey({ destination: "Osaka, Japan" }, "ramen spots"),
    )
    assert.notEqual(
      researchCacheKey({ destination: "Tokyo, Japan" }, "ramen spots"),
      researchCacheKey({ destination: "Tokyo, Japan" }, "where to stay"),
    )
  })
})

describe("researchSearchLocation", () => {
  it("searches the real destination, never a mangled fragment of it", () => {
    const query = researchSearchLocation({
      destination: DESTINATIONS.usSanDiego,
      countryCode: "US",
      countryName: "United States",
    })
    assert.match(query, /San Diego/)
    assert.ok(!/^ca, usa$/i.test(query), "must not degrade to the state+country fragment")
  })

  it("appends the country name when the destination does not already name it", () => {
    assert.equal(
      researchSearchLocation({ destination: "Tokyo", countryCode: "JP", countryName: "Japan" }),
      "Tokyo, Japan",
    )
  })

  it("does not repeat a country the destination already names", () => {
    assert.equal(
      researchSearchLocation({
        destination: "Tokyo, Japan",
        countryCode: "JP",
        countryName: "Japan",
      }),
      "Tokyo, Japan",
    )
  })

  it("collapses whitespace and drops characters that would break an XML attribute", () => {
    const query = researchSearchLocation({ destination: '  Kyoto "<b>"   Japan  ' })
    assert.ok(!/["<>&]/.test(query))
    assert.ok(!/\s{2,}/.test(query))
  })
})

describe("normalizeResearchDestination", () => {
  it("normalizes case, whitespace and separator padding only", () => {
    assert.equal(normalizeResearchDestination("  Tokyo ,  Japan "), "tokyo, japan")
    assert.equal(normalizeResearchDestination("Tokyo"), "tokyo")
    assert.equal(normalizeResearchDestination("   "), "")
  })

  it("never drops a segment — two different addresses must never normalize alike", () => {
    // The old rule dropped every segment but the last two (after stripping
    // digits), which is what merged San Francisco into San Diego.
    assert.notEqual(
      normalizeResearchDestination(DESTINATIONS.usSanFrancisco),
      normalizeResearchDestination(DESTINATIONS.usSanDiego),
    )
    assert.notEqual(
      normalizeResearchDestination(DESTINATIONS.japan),
      normalizeResearchDestination(DESTINATIONS.japan2),
    )
    assert.equal(
      normalizeResearchDestination(DESTINATIONS.uk),
      "10 downing st, london sw1a 2aa, uk",
    )
  })
})

describe("researchIntent", () => {
  it("buckets prompts by the topic that actually determines the research", () => {
    assert.equal(researchIntent("find me some great ramen spots"), "food")
    assert.equal(researchIntent("jazz bars and cocktails after dinner"), "nightlife")
    assert.equal(researchIntent("hotels accommodation airbnb near the station"), "accommodation")
    assert.equal(researchIntent("temples and museums to visit"), "attractions")
    assert.equal(researchIntent("a day hike with mountain views"), "outdoors")
    assert.equal(researchIntent("souvenir shopping and markets"), "shopping")
  })

  it("falls back to general when nothing matches", () => {
    assert.equal(researchIntent(""), "general")
    assert.equal(researchIntent(undefined), "general")
    assert.equal(researchIntent("just do something nice"), "general")
  })

  it("is stable regardless of phrasing or case", () => {
    assert.equal(researchIntent("Where should we EAT lunch?"), researchIntent("good lunch places"))
  })
})

/**
 * Bucket `inputs` in a child process pinned to `tz`.
 *
 * A subprocess is the only honest way to test this: the test runner freezes the
 * process timezone at startup, so mutating `process.env.TZ` in-process silently
 * does nothing and an in-process "timezone independence" test would pass against
 * the very implementation that reads `new Date(...).getHours()`.
 */
function bucketsUnderTimezone(tz: string, inputs: readonly string[]): string[] {
  const modulePath = fileURLToPath(new URL("./ai-cache.ts", import.meta.url))
  const script = `const { timeOfDayBucket } = await import(${JSON.stringify(modulePath)});
process.stdout.write(JSON.stringify(${JSON.stringify(inputs)}.map(timeOfDayBucket)))`
  const out = execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  })
  return JSON.parse(out) as string[]
}

describe("timeOfDayBucket", () => {
  it("reads the wall clock off an offset-carrying local time (the shape production sends)", () => {
    // `deriveFlightFields` exposes exactly this shape as `arrivalTimeLocal`,
    // e.g. "2026-08-16 11:05+07:00" — local at the ARRIVAL airport.
    assert.equal(timeOfDayBucket("2026-08-16 11:05+07:00"), "morning")
    assert.equal(timeOfDayBucket("2026-08-04T03:00:00+08:00"), "night")
    assert.equal(timeOfDayBucket("2026-08-04T14:20:00-05:00"), "afternoon")
    assert.equal(timeOfDayBucket("2026-08-04T21:00:00+0530"), "evening")
  })

  it("buckets a bare local timestamp textually", () => {
    assert.equal(timeOfDayBucket("2026-08-04T03:00:00"), "night")
    assert.equal(timeOfDayBucket("2026-08-04T09:30:00"), "morning")
    assert.equal(timeOfDayBucket("2026-08-04T12:00:00"), "afternoon")
    assert.equal(timeOfDayBucket("2026-08-04T19:45:00"), "evening")
  })

  it("covers every boundary hour exactly once", () => {
    assert.equal(timeOfDayBucket("2026-08-04T00:00:00+07:00"), "night")
    assert.equal(timeOfDayBucket("2026-08-04T05:59:00+07:00"), "night")
    assert.equal(timeOfDayBucket("2026-08-04T06:00:00+07:00"), "morning")
    assert.equal(timeOfDayBucket("2026-08-04T11:59:00+07:00"), "morning")
    assert.equal(timeOfDayBucket("2026-08-04T12:00:00+07:00"), "afternoon")
    assert.equal(timeOfDayBucket("2026-08-04T17:59:00+07:00"), "afternoon")
    assert.equal(timeOfDayBucket("2026-08-04T18:00:00+07:00"), "evening")
    assert.equal(timeOfDayBucket("2026-08-04T23:59:00+07:00"), "evening")
  })

  it("does not move with the server timezone (issue #15)", () => {
    // The old implementation fell through to `new Date(...).getHours()` for every
    // input carrying a designator — which every real caller sends — so these runs
    // disagreed. Vercel is UTC; a dev box usually is not.
    const inputs = [
      "2026-08-16 11:05+07:00",
      "2026-08-04T03:00:00+08:00",
      "2026-08-04T19:45:00",
      "2026-08-04T23:30:00-03:00",
    ] as const
    const expected = ["morning", "night", "evening", "evening"]
    for (const tz of ["UTC", "Asia/Singapore", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      assert.deepEqual(bucketsUnderTimezone(tz, inputs), expected, `bucket changed under TZ=${tz}`)
    }
  })

  it("refuses to guess a local clock from a bare UTC instant", () => {
    // `flights.arrivalTime` is `timestamp with timezone` and serialises with `Z`.
    // A UTC instant alone cannot say what the airport clock read, and guessing
    // (the old behaviour) cached a wrong bucket for 30 days.
    assert.equal(timeOfDayBucket("2026-08-04T03:00:00Z"), "unknown")
    assert.equal(timeOfDayBucket("2026-08-03T19:00:00.000Z"), "unknown")
  })

  it("returns unknown for null or unparseable input", () => {
    assert.equal(timeOfDayBucket(null), "unknown")
    assert.equal(timeOfDayBucket(undefined), "unknown")
    assert.equal(timeOfDayBucket("not a date"), "unknown")
    assert.equal(timeOfDayBucket("2026-08-04T99:00:00+07:00"), "unknown")
  })
})

describe("formatLayoverDuration", () => {
  it("never reports a sub-hour layover as 0 hours (issue #15)", () => {
    assert.equal(formatLayoverDuration(45), "45-minute")
    assert.equal(formatLayoverDuration(59), "59-minute")
  })

  it("reports whole hours plainly", () => {
    assert.equal(formatLayoverDuration(60), "1-hour")
    assert.equal(formatLayoverDuration(360), "6-hour")
  })

  it("keeps the minutes on a mixed duration", () => {
    assert.equal(formatLayoverDuration(179), "2-hour 59-minute")
    assert.equal(formatLayoverDuration(390), "6-hour 30-minute")
  })
})

describe("layoverTipsCacheKey", () => {
  it("distinguishes arrivals at different times of day (issue #15)", () => {
    assert.notEqual(
      layoverTipsCacheKey("SIN", 360, "visa_free", "night"),
      layoverTipsCacheKey("SIN", 360, "visa_free", "afternoon"),
    )
  })

  it("is stable for the same inputs", () => {
    assert.equal(
      layoverTipsCacheKey("SIN", 360, "visa_free", "night"),
      layoverTipsCacheKey("SIN", 360, "visa_free", "night"),
    )
  })

  it("still distinguishes airport, duration and visa status", () => {
    const base = layoverTipsCacheKey("SIN", 360, "visa_free", "night")
    assert.notEqual(base, layoverTipsCacheKey("HND", 360, "visa_free", "night"))
    assert.notEqual(base, layoverTipsCacheKey("SIN", 420, "visa_free", "night"))
    assert.notEqual(base, layoverTipsCacheKey("SIN", 360, "visa_required", "night"))
  })

  it("keys short layovers apart from long ones instead of rounding them together", () => {
    // 45min and 6h both used to floor into a key that lost the distinction the
    // prompt's "under 3 hours" rule depends on.
    assert.notEqual(
      layoverTipsCacheKey("SIN", 45, "visa_free", "night"),
      layoverTipsCacheKey("SIN", 360, "visa_free", "night"),
    )
    assert.notEqual(
      layoverTipsCacheKey("SIN", 179, "visa_free", "night"),
      layoverTipsCacheKey("SIN", 180, "visa_free", "night"),
    )
  })

  it("buckets near-identical durations together so two travellers on one flight still hit", () => {
    assert.equal(
      layoverTipsCacheKey("SIN", 365, "visa_free", "night"),
      layoverTipsCacheKey("SIN", 372, "visa_free", "night"),
    )
  })
})

describe("isCacheableResearch", () => {
  it("accepts a non-empty research block", () => {
    assert.equal(isCacheableResearch("<research_results>…</research_results>"), true)
  })

  it("rejects empty results and non-strings (never cache failures)", () => {
    assert.equal(isCacheableResearch(""), false)
    assert.equal(isCacheableResearch(null), false)
    assert.equal(isCacheableResearch(undefined), false)
  })
})
