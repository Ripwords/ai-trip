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

  // Shared state from the dark-mode plugin — useHead reads this
  const isDark = useState("dark-mode", () => false)

  if (import.meta.client && !mediaQuery) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

    // Update isDark when system preference changes
    mediaQuery.addEventListener("change", () => {
      if (mode.value === "system") {
        isDark.value = mediaQuery!.matches
      }
    })

    // Migrate from localStorage to cookie (one-time)
    const saved = localStorage.getItem("theme-mode") as ThemeMode | null
    if (saved && ["light", "dark", "system"].includes(saved)) {
      mode.value = saved
      localStorage.removeItem("theme-mode")
    }

    // Apply system preference now (post-hydration for "system" mode users)
    if (mode.value === "system" && mediaQuery.matches) {
      isDark.value = true
    }
  }

  // Keep isDark in sync when mode changes (e.g. user toggles theme)
  watch(mode, (newMode) => {
    if (newMode === "dark") isDark.value = true
    else if (newMode === "light") isDark.value = false
    else if (newMode === "system" && import.meta.client) {
      isDark.value = mediaQuery?.matches ?? false
    }
  })

  function setMode(newMode: ThemeMode) {
    // Smooth transition
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
