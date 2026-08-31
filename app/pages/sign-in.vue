<script setup lang="ts">
import { authClient } from "../lib/auth-client"

// The default layout carries its own "Sign in with Google" button hardcoded to
// callbackURL: "/dashboard". Rendering it here would give a visitor a second
// button that silently discards an in-flight OAuth authorization request.
definePageMeta({ layout: false })

useSeoMeta({
  title: "Sign in",
  description: "Sign in to AI Trip to plan and manage your trips.",
})

const route = useRoute()
const carriesAuthorization = computed(() => !!route.query.client_id && !!route.query.sig)

const heading = computed(() =>
  carriesAuthorization.value ? "Sign in to continue" : "Welcome back",
)
const blurb = computed(() =>
  carriesAuthorization.value
    ? "An app is asking to connect to your AI Trip account. Sign in first, then you can review what it wants."
    : "Sign in to plan and manage your trips.",
)

const signInPending = ref(false)

function signInWithGoogle() {
  signInPending.value = true
  authClient.signIn.social({
    provider: "google",
    // The raw string, not `route.query`: flattening the query to an object drops
    // the repeated `resource` and `ba_param` entries the authorization signature
    // covers. `resolveSignInTarget` owns where this may send someone afterwards.
    callbackURL: resolveSignInTarget(window.location.search),
    errorCallbackURL: "/",
  })
}
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center justify-center gap-8 bg-sand-50 px-4 py-12">
    <NuxtLink to="/" class="flex min-h-11 items-center gap-2">
      <NuxtImg src="/image.png" alt="AI Trip" class="h-8 w-8 rounded-lg" loading="eager" />
      <span class="font-display text-lg text-sand-900">AI Trip</span>
    </NuxtLink>

    <div class="w-full max-w-sm rounded-2xl border border-sand-200 bg-white p-6 text-center">
      <h1 class="font-display text-xl text-sand-900">{{ heading }}</h1>
      <p class="mt-2 text-sm leading-relaxed text-sand-600">{{ blurb }}</p>

      <button
        type="button"
        :disabled="signInPending"
        class="focus-ring mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cta px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-cta-hover hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
        @click="signInWithGoogle"
      >
        <Icon
          v-if="signInPending"
          name="lucide:loader"
          class="h-4 w-4 animate-spin"
          aria-hidden="true"
        />
        <svg v-else class="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#fff"
            opacity="0.95"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#fff"
            opacity="0.85"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#fff"
            opacity="0.75"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#fff"
          />
        </svg>
        {{ signInPending ? "Redirecting..." : "Sign in with Google" }}
      </button>
    </div>
  </div>
</template>
