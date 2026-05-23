/**
 * Bun test preload: stubs Nitro/h3 globals that are unavailable outside the
 * Nitro runtime, so unit tests can import server modules without errors.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any

if (!g.defineCachedFunction) {
  // Return the unwrapped function so modules can still call it.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  g.defineCachedFunction = (_fn: Function, opts?: unknown) => _fn
}

if (!g.useRuntimeConfig) {
  g.useRuntimeConfig = () => ({ privateGoogleMapsApiKey: "", public: { googleMapsApiKey: "" } })
}

if (!g.createError) {
  g.createError = (opts: { statusCode?: number; message?: string }) => {
    const err = new Error(opts.message ?? "Error")
    Object.assign(err, { statusCode: opts.statusCode })
    return err
  }
}

if (!g.$fetch) {
  // Default test stub: any call that wasn't intercepted via opts.fetchImpl
  // throws a 503 — callers handle that as "API unavailable" and fall back.
  g.$fetch = async () => {
    const err = new Error("$fetch is not available in tests") as Error & { statusCode?: number }
    err.statusCode = 503
    throw err
  }
}
