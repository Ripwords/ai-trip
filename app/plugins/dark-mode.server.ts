/**
 * Server-side plugin: reads the theme-mode cookie and applies the .dark
 * class to <html> during SSR so the rendered HTML matches the client.
 * This prevents hydration mismatches from dark mode.
 */
export default defineNuxtPlugin(() => {
  const mode = useCookie("theme-mode")

  // Only "dark" is deterministic on the server.
  // "system" requires the client's media query — we default to light
  // and accept a brief flash for system-dark users on first load.
  if (mode.value === "dark") {
    useHead({
      htmlAttrs: { class: "dark" },
    })
  }
})
