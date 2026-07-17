import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  buildDayPromptFromOutline,
  MAX_DAY_PROMPT_CHARS,
  type OutlineDayEntry,
} from "./outline-prompt"

const entry: OutlineDayEntry = {
  dayId: "d1",
  dayNumber: 3,
  theme: "Old-town temples & street food",
  focusArea: "Gion",
  mustInclude: ["Kiyomizu-dera", "Nishiki Market"],
  guidance: "Start late — the traveler lands at 22:00 the night before.",
}

describe("buildDayPromptFromOutline", () => {
  it("includes theme, focus area, guidance and must-includes", () => {
    const prompt = buildDayPromptFromOutline(entry, ["Fushimi Inari"])
    assert.match(prompt, /Old-town temples & street food/)
    assert.match(prompt, /Gion/)
    assert.match(prompt, /lands at 22:00/)
    assert.match(prompt, /Kiyomizu-dera/)
    assert.match(prompt, /Nishiki Market/)
    assert.match(prompt, /Fushimi Inari/)
  })

  it("omits empty sections cleanly (no dangling labels or double spaces)", () => {
    const bare = buildDayPromptFromOutline({ ...entry, mustInclude: [], guidance: "" }, [])
    assert.doesNotMatch(bare, /Include if/)
    assert.doesNotMatch(bare, /Do NOT include/)
    assert.doesNotMatch(bare, /\s{2,}/)
    assert.match(bare, /Old-town temples & street food/)
  })

  it("stays within the cap with 100 long avoid entries, dropping whole entries", () => {
    const avoid = Array.from({ length: 100 }, (_, i) => `A Very Long Venue Name Number ${i}`)
    const prompt = buildDayPromptFromOutline(entry, avoid)
    assert.ok(prompt.length <= MAX_DAY_PROMPT_CHARS, `prompt was ${prompt.length} chars`)
    // Never truncates mid-name: every avoid entry present appears in full.
    const listed = prompt.split("Do NOT include: ")[1] ?? ""
    for (const name of listed.replace(/\.$/, "").split(", ")) {
      assert.ok(avoid.includes(name), `partial entry leaked: ${name}`)
    }
    // Must-includes survive — avoidRepeats is dropped first.
    assert.match(prompt, /Kiyomizu-dera/)
  })

  it("drops mustInclude entries when the base alone would exceed the cap", () => {
    const huge = "x".repeat(1800)
    const prompt = buildDayPromptFromOutline(
      { ...entry, guidance: huge, mustInclude: ["Alpha", "Beta"] },
      ["Gamma"],
    )
    assert.ok(prompt.length <= MAX_DAY_PROMPT_CHARS)
    assert.doesNotMatch(prompt, /Gamma/)
    assert.doesNotMatch(prompt, /Alpha/)
  })

  it("is plain single-line text (survives sanitizePromptInput's collapse)", () => {
    const prompt = buildDayPromptFromOutline(
      { ...entry, guidance: "Line one.\nLine two.\tTabbed." },
      [],
    )
    assert.doesNotMatch(prompt, /[\n\t]/)
    assert.ok(prompt.length > 0)
  })
})
