import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"

import {
  defineMcpTool,
  MCP_SCOPES,
  MCP_TOOLS,
  type McpToolContext,
  type RegisteredMcpTool,
} from "./mcp-tools"

const CTX: McpToolContext = { userId: "user-1" }

type ToolCallback = (input: unknown) => Promise<CallToolResult>

/**
 * The callback `register` hands to the SDK. The stand-in server implements only
 * `registerTool`, so it is cast at that one boundary rather than constructing a
 * real `McpServer` and reaching into its private tool registry.
 */
function capture(tool: RegisteredMcpTool): ToolCallback {
  let captured: ToolCallback | undefined
  const server = {
    registerTool: (_name: string, _config: unknown, cb: ToolCallback) => {
      captured = cb
    },
  } as unknown as McpServer

  tool.register(server, CTX)
  assert.ok(captured, `${tool.name} registered no callback`)
  return captured
}

function textOf(result: CallToolResult): string {
  const block = result.content[0]
  assert.ok(block && block.type === "text", "expected a single text content block")
  return block.text
}

describe("MCP_TOOLS", () => {
  it("declares a known scope for every tool", () => {
    const scopes = new Set<string>(Object.values(MCP_SCOPES))
    for (const tool of MCP_TOOLS) {
      assert.ok(scopes.has(tool.scope), `${tool.name} declares unknown scope ${tool.scope}`)
    }
  })

  it("gives every tool a unique name", () => {
    const names = MCP_TOOLS.map((t) => t.name)
    assert.deepEqual([...new Set(names)].toSorted(), names.toSorted())
  })

  // A tool the caller lacks scope for must be excluded by construction, which
  // only works if every tool is classified read or write.
  it("covers both read and write scopes", () => {
    const scopes = new Set(MCP_TOOLS.map((t) => t.scope))
    assert.ok(scopes.has(MCP_SCOPES.read))
    assert.ok(scopes.has(MCP_SCOPES.write))
  })
})

describe("defineMcpTool", () => {
  const succeeding = defineMcpTool({
    name: "succeeds",
    title: "Succeeds",
    description: "Returns its input back.",
    scope: MCP_SCOPES.read,
    inputSchema: z.object({ tripId: z.string() }),
    execute: async (input, ctx) => ({ tripId: input.tripId, userId: ctx.userId }),
  })

  function throwing(error: unknown): RegisteredMcpTool {
    return defineMcpTool({
      name: "throws",
      title: "Throws",
      description: "Always fails.",
      scope: MCP_SCOPES.read,
      inputSchema: z.object({}),
      execute: async () => {
        throw error
      },
    })
  }

  it("wraps a successful result in a JSON text content block", async () => {
    const result = await capture(succeeding)({ tripId: "trip-1" })

    assert.notEqual(result.isError, true)
    assert.deepEqual(JSON.parse(textOf(result)), { tripId: "trip-1", userId: "user-1" })
  })

  it("passes the parsed input through, not the raw arguments", async () => {
    const result = await capture(succeeding)({ tripId: "trip-1", extra: "dropped" })

    assert.deepEqual(JSON.parse(textOf(result)), { tripId: "trip-1", userId: "user-1" })
  })

  // requireTripAccess throws these, and their messages are already written for
  // the person on the other end.
  it("reports an h3 error's message instead of propagating it", async () => {
    const denied = Object.assign(new Error("You don't have permission to do this"), {
      statusCode: 403,
    })

    const result = await capture(throwing(denied))({})

    assert.equal(result.isError, true)
    assert.equal(textOf(result), "You don't have permission to do this")
  })

  it("hides the message of an error that is not an h3 error", async () => {
    const leaky = new Error("connect ECONNREFUSED 10.0.0.7:5432")

    const result = await capture(throwing(leaky))({})

    assert.equal(result.isError, true)
    assert.doesNotMatch(textOf(result), /ECONNREFUSED|10\.0\.0\.7/)
  })

  it("reports invalid input as a tool error rather than throwing", async () => {
    const result = await capture(succeeding)({ tripId: 42 })

    assert.equal(result.isError, true)
  })
})
