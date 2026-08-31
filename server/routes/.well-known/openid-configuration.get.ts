import { auth } from "../../lib/auth"
import { metadataResponse } from "../../lib/oauth-metadata"

export default defineEventHandler(async (event) => {
  const config: unknown = await auth.api.getOpenIdConfig({
    request: toWebRequest(event),
    asResponse: false,
  })
  return metadataResponse(config)
})
