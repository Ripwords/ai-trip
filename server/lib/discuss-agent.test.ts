import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DISCUSS_SYSTEM_PROMPT, discussAgent } from "./discuss-agent"

describe("discussAgent", () => {
  it("is a Mastra agent with id 'discuss'", () => {
    assert.equal(discussAgent.id, "discuss")
  })

  it("system prompt forbids inventing place names", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /NEVER invent place names/i)
  })

  it("system prompt declares the activity-only-duration rule", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /time spent AT the venue ONLY/i)
    assert.match(DISCUSS_SYSTEM_PROMPT, /travel time/i)
  })

  it("system prompt establishes thinking-partner role", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /thinking partner/i)
  })

  it("system prompt forbids whole-day reschedules from chat", () => {
    assert.match(DISCUSS_SYSTEM_PROMPT, /Optimize chip/i)
  })
})
