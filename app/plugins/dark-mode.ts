/**
 * Universal plugin: applies the .dark class to <html> via useHead on BOTH
 * server and client. This ensures the server-rendered HTML and client
 * virtual DOM agree on the class attribute — no hydration mismatch.
 *
 * Runs once as a plugin, avoiding the multiple-useHead problem that
 * occurred when useDarkMode() was called from 5+ components.
 */
export default defineNuxtPlugin(() => {
  // Shared reactive state for dark mode — accessible from useDarkMode composable
  const isDark = useState("dark-mode", () => false)

  const mode = useCookie<string>("theme-mode", {
    default: () => "system",
  })

  // Resolve dark mode from cookie (works identically on server and client)
  isDark.value = mode.value === "dark"
  // "system" and "light" both resolve to false here — system preference
  // is applied post-hydration by the composable to avoid SSR mismatch

  useHead({
    htmlAttrs: {
      class: computed(() => (isDark.value ? "dark" : "")),
    },
    meta: [
      {
        name: "theme-color",
        content: computed(() => (isDark.value ? "#1a1714" : "#faf8f5")),
      },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "default",
      },
    ],
  })
})
