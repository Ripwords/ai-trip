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
    if (!q || q.length < 2) {
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
    debounceTimer = setTimeout(() => search(val), 400)
  })

  return { query, results, isSearching }
}
