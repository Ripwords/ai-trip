import { createHash } from "node:crypto"

/**
 * Cache key for the web-research pass: a readable destination slug plus a
 * short hash of destination+context. User text never appears raw in the key
 * (context strings are user prompts), and the result is storage-safe.
 * Hash uses JSON encoding to avoid delimiter collisions (e.g., "tokyo::kyoto"+"food"
 * vs "tokyo"+"kyoto::food" are now distinct).
 */
export function researchCacheKey(destination: string, userContext?: string): string {
  const dest = destination.toLowerCase().trim()
  const ctx = (userContext ?? "").toLowerCase().trim()
  const slug = dest
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
  const hash = createHash("sha256")
    .update(JSON.stringify([dest, ctx]))
    .digest("hex")
    .slice(0, 16)
  return `${slug}-${hash}`
}

/** Never cache failed or sanitization-dropped research (empty string). */
export function isCacheableResearch(value: unknown): boolean {
  return typeof value === "string" && value.length > 0
}
