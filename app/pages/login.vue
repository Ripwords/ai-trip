<script setup lang="ts">
import { authClient } from "../lib/auth-client"

useSeoMeta({
  title: "Log In",
  description: "Sign in to AI Trip to plan and manage your travel itineraries.",
})

useSchemaOrg([
  defineWebPage({
    "@type": "WebPage",
    name: "Log In — AI Trip",
    description: "Sign in to AI Trip to plan and manage your travel itineraries.",
  }),
])

const { data: session } = await authClient.useSession(useFetch)
if (session.value?.user) {
  navigateTo("/dashboard")
}

const loading = ref(false)
const error = ref("")

function signInWithGoogle() {
  loading.value = true
  error.value = ""
  // Check for pending invite redirect
  const pendingInvite = import.meta.client ? sessionStorage.getItem("pending-invite") : null
  if (pendingInvite) {
    sessionStorage.removeItem("pending-invite")
  }

  authClient.signIn.social({
    provider: "google",
    callbackURL: pendingInvite || "/dashboard",
    errorCallbackURL: "/login",
  })
}
</script>

<template>
  <div class="relative flex min-h-[85vh] items-center justify-center overflow-hidden px-4">
    <div
      class="pointer-events-none absolute inset-0 bg-gradient-to-br from-sand-50 via-sand-100 to-terra-50/30"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute -right-40 top-20 h-[400px] w-[400px] rounded-full bg-terra-100/40 blur-[100px]"
      aria-hidden="true"
    />

    <div class="relative z-10 w-full max-w-sm">
      <div class="rounded-2xl border border-sand-200/80 bg-white/80 p-8 shadow-xl backdrop-blur-sm">
        <div class="text-center">
          <NuxtLink to="/" class="font-display text-2xl text-terra-600">AI Trip</NuxtLink>
          <h1 class="mt-3 font-display text-xl text-sand-900">Welcome</h1>
          <p class="mt-1 text-sm text-sand-500">Sign in to plan your next adventure</p>
        </div>

        <div class="mt-6">
          <p v-if="error" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {{ error }}
          </p>

          <button
            :disabled="loading"
            class="flex w-full items-center justify-center gap-3 rounded-xl border border-sand-200 bg-white px-4 py-3 text-sm font-medium text-sand-800 shadow-sm transition-all hover:bg-sand-50 hover:shadow-md disabled:opacity-50"
            @click="signInWithGoogle"
          >
            <svg class="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {{ loading ? "Redirecting..." : "Continue with Google" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
