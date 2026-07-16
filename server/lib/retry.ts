/**
 * Run `fn`; on any throw, log and retry exactly once; rethrow the second
 * failure. Covers generateObject schema-validation failures, which the AI
 * SDK's built-in maxRetries (network errors only) does not.
 */
export async function withOneRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`[retry] ${label} failed, retrying once:`, e)
    return await fn()
  }
}
