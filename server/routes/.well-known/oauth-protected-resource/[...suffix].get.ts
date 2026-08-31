import { auth } from "../../../lib/auth"

/**
 * RFC 9728 path insertion: a resource with a path is probed at
 * `/.well-known/oauth-protected-resource<resource path>`. @better-auth/mcp's
 * hook does the matching, and answers with a 404 for a suffix it does not own.
 */
export default defineEventHandler((event) => auth.handler(toWebRequest(event)))
