import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"
import { requireMcpAuth } from "@better-auth/mcp"

import { auth, MCP_RESOURCE } from "../lib/auth"
import { MCP_SCOPES, MCP_TOOLS } from "../lib/mcp-tools"

const SERVER_INFO = { name: "ai-trip", version: "1.0.0" }

/** RFC 6749 `scope`: a space-delimited list, or nothing we can read. */
function grantedScopes(claim: unknown): Set<string> {
  if (typeof claim !== "string") return new Set()
  return new Set(claim.split(" ").filter((scope) => scope.length > 0))
}

function jsonRpcError(status: number, message: string, headers: HeadersInit = {}): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }),
    {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    },
  )
}

const handler = requireMcpAuth(
  auth,
  async (request, claims) => {
    const userId = claims.sub
    if (!userId) {
      return jsonRpcError(401, "Access token carries no subject.", {
        "WWW-Authenticate": `Bearer error="invalid_token", error_description="missing sub claim"`,
      })
    }

    const granted = grantedScopes(claims.scope)
    const tools = MCP_TOOLS.filter((tool) => granted.has(tool.scope))
    // Scope enforcement is by construction: a tool the caller has no scope for
    // is never registered, so it neither lists nor calls. Reaching the endpoint
    // with neither scope is the one case worth a challenge of its own —
    // `requiredScopes` cannot express it, because either scope alone is enough.
    if (tools.length === 0) {
      return jsonRpcError(403, "The access token grants no trip scopes.", {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${MCP_SCOPES.read} ${MCP_SCOPES.write}"`,
      })
    }

    const mcpHandler = createMcpHandler(() => {
      const server = new McpServer(SERVER_INFO)
      for (const tool of tools) tool.register(server, { userId })
      return server
    })

    return await mcpHandler.fetch(request)
  },
  {
    resource: MCP_RESOURCE,
    challengeScopes: [MCP_SCOPES.read, MCP_SCOPES.write],
  },
)

export default defineEventHandler((event) => handler(toWebRequest(event)))
