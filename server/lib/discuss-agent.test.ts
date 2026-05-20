import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DISCUSS_SYSTEM_PROMPT, discussAgent } from "./discuss-agent"

describe("discussAgent", () => {
  it("is a Mastra agent with id 'discuss'", () => {
    assert.equal(discussAgent.id, "discuss")
  })

  it("system prompt requires place verification only for proposals", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /verify the place exists via search_places/i)
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

  it("system prompt forbids whole-day reschedules from chat", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /Optimize chip/i)
  })

  it("system prompt tells the agent to use injected trip context as default", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /trip context is.*injected/i)
  })
})
