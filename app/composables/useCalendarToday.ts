import { onMounted as vueOnMounted, ref, type Ref } from "vue"
import { todayCalendarDate } from "../utils/calendar-date"

interface CalendarTodayOptions {
  /** Whether this render must match server-rendered markup. Defaults to Nuxt's own flag. */
  hydrating?: boolean
  now?: () => Date
  onMounted?: (fn: () => void) => void
}

/**
 * Today as the viewer's own `YYYY-MM-DD`, reactive.
 *
 * The server does not know the viewer's zone, so during SSR and hydration this
 * holds the UTC date — the same string on both sides, so the markup matches —
 * and switches to the viewer's date once mounted. After a client-side
 * navigation there is no server markup to match, so it starts on the viewer's
 * date.
 */
export function useCalendarToday(options: CalendarTodayOptions = {}): Ref<string> {
  const now = options.now ?? (() => new Date())
  const hydrating =
    options.hydrating ??
    (import.meta.server || (import.meta.client && useNuxtApp().isHydrating === true))
  if (!hydrating) return ref(todayCalendarDate(now()))

  const today = ref(now().toISOString().slice(0, 10))
  const whenMounted = options.onMounted ?? vueOnMounted
  whenMounted(() => {
    today.value = todayCalendarDate(now())
  })
  return today
}
