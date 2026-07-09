<script setup lang="ts">
import { authClient } from "../../lib/auth-client"

useSeoMeta({
  title: "Accept Invite",
  description: "Accept an invitation to collaborate on a trip.",
})

const route = useRoute()
const token = route.params.token as string
// Only allow callback URLs of our expected shape — this value is used as the
// post-OAuth navigation target, so an unconstrained value would allow an open
// redirect via /invite/<arbitrary-path>.
const safeToken = /^[A-Za-z0-9_-]{1,128}$/.test(token) ? token : ""

// Use useRequestFetch so cookies are forwarded during SSR — authClient.useSession(useFetch)
// fails to detect sessions on the server, which silently bounced authenticated users.
let isAuthenticated = false
try {
  const fetchWithCookies = useRequestFetch()
  const sessionResponse = await fetchWithCookies<{ user?: unknown }>("/api/auth/get-session")
  isAuthenticated = !!sessionResponse?.user
} catch {
  // Session fetch failed — treat as unauthenticated
}

const loading = ref(false)
const error = ref("")
const success = ref(false)

function signInWithGoogle() {
  authClient.signIn.social({
    provider: "google",
    callbackURL: safeToken ? `/invite/${safeToken}` : "/dashboard",
    errorCallbackURL: "/",
  })
}

async function acceptInvite() {
  loading.value = true
  error.value = ""
  try {
    const result = await $fetch(`/api/invites/${token}`, { method: "POST" })
    success.value = true
    setTimeout(() => navigateTo(`/trips/${result.tripId}`), 1500)
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    error.value = err.data?.message ?? "Failed to accept invite"
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (isAuthenticated) {
    acceptInvite()
  } else {
    signInWithGoogle()
  }
})
</script>

<template>
  <div class="flex min-h-[80dvh] items-center justify-center px-4">
    <div
      class="w-full max-w-sm rounded-2xl border border-sand-200/80 bg-white/80 p-8 shadow-xl backdrop-blur-sm text-center"
    >
      <div v-if="loading" role="status" class="space-y-4">
        <Icon name="lucide:loader" class="mx-auto h-8 w-8 animate-spin text-terra-500" />
        <p class="text-sm text-sand-600">Accepting invite...</p>
      </div>

      <div v-else-if="success" role="status" class="space-y-4">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-forest-50">
          <Icon name="lucide:check" class="h-6 w-6 text-forest-600" />
        </div>
        <h2 class="font-display text-xl text-sand-900">You're in!</h2>
        <p class="text-sm text-sand-600">Redirecting to the trip...</p>
      </div>

      <div v-else-if="error" role="alert" class="space-y-4">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-terra-50">
          <Icon name="lucide:x" class="h-6 w-6 text-terra-600" />
        </div>
        <h2 class="font-display text-xl text-sand-900">Invite Error</h2>
        <p class="text-sm text-sand-600">{{ error }}</p>
        <NuxtLink to="/dashboard" class="mt-4 inline-block text-sm text-terra-600 underline">
          Go to dashboard
        </NuxtLink>
      </div>

      <div v-else role="status" class="space-y-4">
        <Icon name="lucide:loader" class="mx-auto h-8 w-8 animate-spin text-terra-500" />
        <p class="text-sm text-sand-600">Redirecting to sign in...</p>
      </div>
    </div>
  </div>
</template>
