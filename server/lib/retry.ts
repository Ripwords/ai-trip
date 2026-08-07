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

/**
 * Reject if `work` has not settled within `ms`.
 *
 * This does NOT cancel the underlying work — an in-flight model call cannot be
 * recalled, and it will run to completion in the background. The point is to
 * hand control back to the handler *while the function is still alive*, so its
 * catch block can refund the traveler's credits. The failure this prevents is
 * the platform killing the process mid-call: that skips every catch block, so
 * the credit is consumed and never returned.
 *
 * Pairs with `withOneRetry`, which can double the wall-clock cost of a call —
 * the budget must cover both attempts, not one.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bell = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[timeout] ${label} timed out after ${ms}ms`)), ms)
  })
  try {
    // Promise.race settles on whichever lands first, so a genuine rejection from
    // `work` propagates as itself rather than being masked as a timeout.
    return await Promise.race([work, bell])
  } finally {
    // Without this a long budget keeps the event loop open after the response is
    // sent — on a serverless function that is billed idle wall-clock.
    if (timer) clearTimeout(timer)
  }
}
