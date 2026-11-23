import { isStaleChunkError } from "~/utils/chunk-error"

/**
 * Every deploy deletes the previous build's /_nuxt files, so a tab opened before
 * the deploy 404s on the next script it lazy-loads. Nuxt reloads by itself only
 * when that happens during a route change; a lazy component or a dynamic import
 * inside a page falls through to the error page instead ("500 Failed to fetch
 * dynamically imported module"). Reload at that point: the fresh HTML points at
 * files that exist.
 *
 * `reloadNuxtApp` refuses to reload the same path twice within 10 seconds, so a
 * chunk that is really broken shows the error page instead of looping.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("app:error", (error) => {
    if (isStaleChunkError(error)) reloadNuxtApp({ persistState: true })
  })
})
