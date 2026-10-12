import assert from "node:assert/strict"
import { describe, it } from "bun:test"
import { scopeDiscussTools } from "./discuss-tool-scope"

const tools = { readDay: "read", readTripSummary: "summary", proposeAdd: "add" }

describe("scopeDiscussTools (B22)", () => {
  // Trip-level discuss has no open day. readDay used to stay on offer with
  // activeDayId "", so a call ran `WHERE id = ''` against a uuid column,
  // failed, and still cost the user a metered step.
  it("drops readDay when no day is open", () => {
    const scoped = scopeDiscussTools(tools, null)
    assert.deepEqual(Object.keys(scoped).sort(), ["proposeAdd", "readTripSummary"])
  })

  it("keeps every tool when a day is open", () => {
    assert.deepEqual(scopeDiscussTools(tools, "33333333-3333-4333-8333-333333333333"), tools)
  })
})
