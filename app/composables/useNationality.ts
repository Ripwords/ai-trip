/**
 * Shared nationality state — survives SSR hydration and is consistent
 * between settings page and visa checker modal.
 */
export function useNationality() {
  const nationality = useState<string | null>("user-nationality", () => null)
  const loading = useState<boolean>("user-nationality-loading", () => false)

  async function fetch() {
    const profile = await $fetch("/api/user/profile")
    nationality.value = profile?.nationality ?? null
  }

  async function save(value: string | null) {
    loading.value = true
    try {
      await $fetch("/api/user/profile", {
        method: "PUT",
        body: { nationality: value },
      })
      nationality.value = value
    } catch (e: unknown) {
      console.error("Failed to save nationality:", e)
    } finally {
      loading.value = false
    }
  }

  return { nationality, loading, fetch, save }
}
