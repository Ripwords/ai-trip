type ThemeMode = "light" | "dark" | "system";

const mode = ref<ThemeMode>("system");
const isDark = ref(false);

let mediaQuery: MediaQueryList | null = null;

function applyTheme() {
  if (!import.meta.client) return;

  const shouldBeDark =
    mode.value === "dark" ||
    (mode.value === "system" && mediaQuery?.matches);

  isDark.value = !!shouldBeDark;

  // Add transitioning class for smooth color change
  document.documentElement.classList.add("transitioning");
  if (shouldBeDark) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }

  // Remove transitioning class after animation
  setTimeout(() => {
    document.documentElement.classList.remove("transitioning");
  }, 300);
}

export function useDarkMode() {
  if (import.meta.client && !mediaQuery) {
    // Restore saved preference
    const saved = localStorage.getItem("theme-mode") as ThemeMode | null;
    if (saved && ["light", "dark", "system"].includes(saved)) {
      mode.value = saved;
    }

    // Listen for system preference changes
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applyTheme);

    // Apply immediately
    applyTheme();
  }

  function setMode(newMode: ThemeMode) {
    mode.value = newMode;
    if (import.meta.client) {
      localStorage.setItem("theme-mode", newMode);
    }
    applyTheme();
  }

  function cycle() {
    const modes: ThemeMode[] = ["light", "dark", "system"];
    const current = modes.indexOf(mode.value);
    setMode(modes[(current + 1) % modes.length]);
  }

  const modeIcon = computed(() => {
    switch (mode.value) {
      case "light": return "lucide:sun";
      case "dark": return "lucide:moon";
      case "system": return "lucide:monitor";
    }
  });

  const modeLabel = computed(() => {
    switch (mode.value) {
      case "light": return "Light";
      case "dark": return "Dark";
      case "system": return "System";
    }
  });

  return { mode, isDark, setMode, cycle, modeIcon, modeLabel };
}
