import { auth } from "../../lib/auth"
import { metadataResponse } from "../../lib/oauth-metadata"

/**
 * better-call marks the provider's own discovery endpoints `SERVER_ONLY` and
 * skips them when building its route table, so nothing serves them under
 * `/api/auth`. They exist only as server-side callables, forwarded from here.
 */
export default defineEventHandler(async (event) => {
  const config: unknown = await auth.api.getOAuthServerConfig({
    request: toWebRequest(event),
    asResponse: false,
  })
  return metadataResponse(config)
})
