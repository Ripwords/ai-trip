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
