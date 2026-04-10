<script setup lang="ts">
import { authClient } from "../../lib/auth-client"

useSeoMeta({
  title: "Accept Invite",
  description: "Accept an invitation to collaborate on a trip.",
})

const route = useRoute()
const token = route.params.token as string

const { data: session } = await authClient.useSession(useFetch)
const loading = ref(false)
const error = ref("")
const success = ref(false)

// If not logged in, redirect to login first (they'll come back after)
if (!session.value?.user) {
  // Store the invite URL so we can redirect back after login
  if (import.meta.client) {
    sessionStorage.setItem("pending-invite", `/invite/${token}`)
  }
  navigateTo("/login")
}

async function acceptInvite() {
  loading.value = true
  error.value = ""
  try {
    const result = await $fetch(`/api/invites/${token}`, { method: "POST" })
    success.value = true
    // Redirect to the trip after a short delay
    setTimeout(() => navigateTo(`/trips/${result.tripId}`), 1500)
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    error.value = err.data?.message ?? "Failed to accept invite"
  } finally {
    loading.value = false
  }
}

// Auto-accept on mount
onMounted(() => {
  if (session.value?.user) {
    acceptInvite()
  }
})
</script>

<template>
  <div class="flex min-h-[80vh] items-center justify-center px-4">
    <div
      class="w-full max-w-sm rounded-2xl border border-sand-200/80 bg-white/80 p-8 shadow-xl backdrop-blur-sm text-center"
    >
      <div v-if="loading" class="space-y-4">
        <Icon name="lucide:loader" class="mx-auto h-8 w-8 animate-spin text-terra-500" />
        <p class="text-sm text-sand-600">Accepting invite...</p>
      </div>

      <div v-else-if="success" class="space-y-4">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-forest-50">
          <Icon name="lucide:check" class="h-6 w-6 text-forest-600" />
        </div>
        <h2 class="font-display text-xl text-sand-900">You're in!</h2>
        <p class="text-sm text-sand-600">Redirecting to the trip...</p>
      </div>

      <div v-else-if="error" class="space-y-4">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-terra-50">
          <Icon name="lucide:x" class="h-6 w-6 text-terra-600" />
        </div>
        <h2 class="font-display text-xl text-sand-900">Invite Error</h2>
        <p class="text-sm text-sand-600">{{ error }}</p>
        <NuxtLink to="/dashboard" class="mt-4 inline-block text-sm text-terra-600 underline">
          Go to dashboard
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
