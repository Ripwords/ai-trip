import { auth, AUTH_BASE_PATH } from "../../../lib/auth"
import { metadataResponse } from "../../../lib/oauth-metadata"

/**
 * RFC 8414 path insertion: an issuer with a path is probed at
 * `/.well-known/oauth-authorization-server<issuer path>`. Only this app's own
 * issuer path is served — any other suffix names a different authorization
 * server and must not be answered with ours.
 */
export default defineEventHandler(async (event) => {
  const suffix = getRouterParam(event, "suffix") ?? ""
  if (`/${suffix}` !== AUTH_BASE_PATH) {
    throw createError({ statusCode: 404, message: "Not Found" })
  }

  const config: unknown = await auth.api.getOAuthServerConfig({
    request: toWebRequest(event),
    asResponse: false,
  })
  return metadataResponse(config)
})
