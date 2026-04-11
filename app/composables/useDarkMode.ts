type ThemeMode = "light" | "dark" | "system"

const COOKIE_NAME = "theme-mode"

let mediaQuery: MediaQueryList | null = null

export function useDarkMode() {
  // Use cookie instead of localStorage so the server can read the preference
  // and render the correct theme — eliminates SSR hydration mismatch
  const mode = useCookie<ThemeMode>(COOKIE_NAME, {
    default: () => "system",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: "/",
    sameSite: "lax",
  })

  const isDark = computed(() => {
    if (mode.value === "dark") return true
    if (mode.value === "light") return false
    // "system" — check media query on client, default to false on server
    if (import.meta.client && mediaQuery) return mediaQuery.matches
    return false
  })

  // Apply the dark class to <html> via useHead so it works in SSR
  useHead({
    htmlAttrs: {
      class: computed(() => (isDark.value ? "dark" : "")),
    },
  })

  if (import.meta.client && !mediaQuery) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    mediaQuery.addEventListener("change", () => {
      // Force reactivity update when system preference changes
      if (mode.value === "system") {
        // Toggle to trigger recomputation
        const current = mode.value
        mode.value = "light"
        nextTick(() => {
          mode.value = current
        })
      }
    })

    // Migrate from localStorage to cookie (one-time)
    const saved = localStorage.getItem("theme-mode") as ThemeMode | null
    if (
      saved &&
      ["light", "dark", "system"].includes(saved) &&
      !document.cookie.includes(COOKIE_NAME)
    ) {
      mode.value = saved
      localStorage.removeItem("theme-mode")
    }
  }

  function setMode(newMode: ThemeMode) {
    // Add transitioning class for smooth color change
    if (import.meta.client) {
      document.documentElement.classList.add("transitioning")
      setTimeout(() => {
        document.documentElement.classList.remove("transitioning")
      }, 300)
    }
    mode.value = newMode
  }

  function cycle() {
    const modes: ThemeMode[] = ["light", "dark", "system"]
    const current = modes.indexOf(mode.value)
    setMode(modes[(current + 1) % modes.length]!)
  }

  const modeIcon = computed(() => {
    switch (mode.value) {
      case "light":
        return "lucide:sun"
      case "dark":
        return "lucide:moon"
      case "system":
        return "lucide:monitor"
    }
  })

  const modeLabel = computed(() => {
    switch (mode.value) {
      case "light":
        return "Light"
      case "dark":
        return "Dark"
      case "system":
        return "System"
    }
  })

  return { mode, isDark, setMode, cycle, modeIcon, modeLabel }
}
