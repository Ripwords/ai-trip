/** Matches the caching @better-auth/oauth-provider applies to its own metadata. */
const METADATA_CACHE_CONTROL = "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400"

/**
 * Serialize an OAuth discovery document.
 *
 * `@better-auth/oauth-provider` exports `oauthProviderAuthServerMetadata` for
 * this, but it is only a transitive dependency here, so the three lines it runs
 * are reproduced rather than imported from a package this app does not declare.
 */
export function metadataResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": METADATA_CACHE_CONTROL,
    },
  })
}
