export interface PlaceResult {
  name: string
  placeId: string
  lat: number
  lng: number
  rating?: number
  formattedAddress?: string
  types?: string[]
}

export function usePlaceSearch() {
  const query = ref("")
  const results = ref<PlaceResult[]>([])
  const isSearching = ref(false)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function search(q: string) {
    // Min length 3 (was 2): two-char queries return very generic results
    // and inflate Text Search call volume during fast typing.
    if (!q || q.length < 3) {
      results.value = []
      return
    }

    isSearching.value = true
    try {
      results.value = await $fetch<PlaceResult[]>("/api/places/search", {
        query: { query: q },
      })
    } catch {
      results.value = []
    } finally {
      isSearching.value = false
    }
  }

  watch(query, (val) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    // Debounce 600ms (was 400ms): each keystroke that fires is a paid
    // Text Search call, so we wait until the user actually pauses.
    debounceTimer = setTimeout(() => search(val), 600)
  })

  return { query, results, isSearching }
}
