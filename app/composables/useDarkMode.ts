type ThemeMode = "light" | "dark" | "system"

const COOKIE_NAME = "theme-mode"

let mediaQuery: MediaQueryList | null = null

export function useDarkMode() {
  const mode = useCookie<ThemeMode>(COOKIE_NAME, {
    default: () => "system",
    maxAge: 60 * 60 * 24 * 365,
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

  if (import.meta.client && !mediaQuery) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    mediaQuery.addEventListener("change", () => {
      // Trigger reactivity for system mode by toggling the cookie
      if (mode.value === "system") {
        mode.value = "light"
        nextTick(() => {
          mode.value = "system"
        })
      }
    })

    // Migrate from localStorage to cookie (one-time)
    const saved = localStorage.getItem("theme-mode") as ThemeMode | null
    if (saved && ["light", "dark", "system"].includes(saved)) {
      mode.value = saved
      localStorage.removeItem("theme-mode")
    }
  }

  // Apply dark class to <html> on client — direct DOM manipulation avoids
  // hydration issues from multiple useHead calls across components
  if (import.meta.client) {
    watch(
      isDark,
      (dark) => {
        document.documentElement.classList.add("transitioning")
        document.documentElement.classList.toggle("dark", dark)
        setTimeout(() => {
          document.documentElement.classList.remove("transitioning")
        }, 300)
      },
      { immediate: true },
    )
  }

  function setMode(newMode: ThemeMode) {
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
