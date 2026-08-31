/**
 * What `createMcpHandler` answers a GET or DELETE with — this endpoint is
 * stateless POST-only, so there is no session to resume or delete. Nuxt would
 * otherwise 404 those routes, and an MCP client probing GET for the legacy SSE
 * stream deserves the honest answer.
 */
export function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } },
  )
}
