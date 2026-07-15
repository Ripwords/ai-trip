import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DISCUSS_SYSTEM_PROMPT, discussAgent } from "./discuss-agent"

describe("discussAgent", () => {
  it("is a Mastra agent with id 'discuss'", () => {
    assert.equal(discussAgent.id, "discuss")
  })

  it("system prompt requires place verification only for proposals", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /verify the place exists via searchPlaces/i)
  })

  it("system prompt allows free discussion of named places using general knowledge", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /general knowledge/i)
    assert.match(DISCUSS_SYSTEM_PROMPT, /Talk about named places freely/i)
  })

  it("system prompt declares the activity-only-duration rule", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /time AT the venue/i)
    assert.match(DISCUSS_SYSTEM_PROMPT, /travel/i)
  })

  it("system prompt establishes thinking-partner role", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /thinking partner/i)
  })

  it("system prompt tells the agent to use injected trip context as default", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /trip context is.*injected/i)
  })

  it("system prompt treats trip preferences as soft signals, not hard constraints", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /SOFT signal/i)
    assert.match(DISCUSS_SYSTEM_PROMPT, /form defaults/i)
  })

  it("system prompt references tools by their actual camelCase ids", () => {
    // Guard against drift back to snake_case names that don't match createDiscussTools.
    const camelTools = [
      "readDay",
      "readTripSummary",
      "webSearch",
      "searchPlaces",
      "getPlaceDetails",
      "getDistance",
      "runReview",
      "proposeAddActivities",
      "proposeReorder",
      "proposeSetAccommodation",
    ]
    for (const name of camelTools) {
      assert.ok(DISCUSS_SYSTEM_PROMPT.includes(name), `prompt should mention ${name}`)
    }
    assert.doesNotMatch(DISCUSS_SYSTEM_PROMPT, /\bsearch_places\b/)
    assert.doesNotMatch(DISCUSS_SYSTEM_PROMPT, /\bread_day\b/)
    assert.doesNotMatch(DISCUSS_SYSTEM_PROMPT, /\bweb_search\b/)
  })

  it("prompt teaches multi-day targeting and ambiguity handling", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /\[day:/) // references the day-id token
    assert.match(DISCUSS_SYSTEM_PROMPT, /dayIds|multiple days|several days/i)
    assert.match(DISCUSS_SYSTEM_PROMPT, /ambiguous|which day|clarif/i)
    // The old hard blocks must be gone:
    assert.doesNotMatch(DISCUSS_SYSTEM_PROMPT, /you do NOT pass a day id/i)
    assert.doesNotMatch(DISCUSS_SYSTEM_PROMPT, /ask the user to open that day/i)
  })
})
