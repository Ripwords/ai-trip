import { auth } from "../../lib/auth"

/**
 * Unlike the two authorization-server documents, RFC 9728 resource metadata has
 * no server-side callable: @better-auth/mcp serves it from an `onRequest` hook
 * that matches the bare origin path. That hook runs before better-call's
 * basePath filter, so handing it the untouched request is what answers it.
 */
export default defineEventHandler((event) => auth.handler(toWebRequest(event)))
