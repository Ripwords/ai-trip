<script setup lang="ts">
// better-auth's `onAPIError.errorURL` target (`server/lib/auth.ts`). Arrivals
// are 302s from `/api/auth/error`, always carrying `?error=<code>` and
// sometimes `&error_description=`. `auth.global.ts` sends anyone who reaches
// this URL without a code back to `/`, so the page can assume a real failure.

// The default layout renders its own "Sign in with Google" button, which would
// invite a second attempt at whatever just failed from inside a dead end.
definePageMeta({ layout: false })

useSeoMeta({
  title: "Sign-in problem",
  description: "Something went wrong while signing you in.",
  robots: "noindex, nofollow",
})

const route = useRoute()

const code = computed(() => {
  const raw = route.query.error
  return typeof raw === "string" && raw ? raw : "UNKNOWN"
})

/**
 * Codes better-auth actually emits on the OAuth callback (`OAUTH_CALLBACK_ERROR_CODES`
 * plus `state_not_found`, `invalid_callback_request` and the space-to-underscore
 * `signup_disabled`), plus the `access_denied` a provider returns when the
 * visitor refuses consent. Anything unmapped — including the SCREAMING_SNAKE
 * codes that come from a thrown APIError — falls through to the generic line,
 * rather than showing someone a raw `error_description` from upstream.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  access_denied: "You cancelled the sign-in, so nothing was shared with AI Trip.",
  state_not_found: "That sign-in took too long to come back. Starting again should work.",
  invalid_callback_request: "That sign-in took too long to come back. Starting again should work.",
  no_code: "Google didn't send us back what we needed. Please try again.",
  invalid_code: "Google didn't send us back what we needed. Please try again.",
  unable_to_get_user_info: "We couldn't read your Google profile. Please try again.",
  email_not_found: "Google didn't share an email address, which we need to create your account.",
  email_not_verified: "Google hasn't verified that email address, so we can't sign you in with it.",
  email_does_not_match: "That Google account uses a different email than the one on file.",
  account_already_linked_to_different_user:
    "That Google account is already linked to another AI Trip account.",
  unable_to_link_account: "We couldn't link that Google account. Please try again.",
  signup_disabled: "New accounts aren't open right now.",
}

const message = computed(
  () =>
    MESSAGES[code.value] ??
    "Something went wrong while signing you in. Trying again usually clears it.",
)
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center justify-center gap-8 bg-sand-50 px-4 py-12">
    <NuxtLink to="/" class="flex min-h-11 items-center gap-2">
      <NuxtImg src="/image.png" alt="AI Trip" class="h-8 w-8 rounded-lg" loading="eager" />
      <span class="font-display text-lg text-sand-900">AI Trip</span>
    </NuxtLink>

    <div class="w-full max-w-sm rounded-2xl border border-sand-200 bg-white p-6 text-center">
      <Icon name="lucide:circle-alert" class="h-8 w-8 text-terra-500" aria-hidden="true" />
      <h1 class="mt-3 font-display text-xl text-sand-900">We couldn't sign you in</h1>
      <p class="mt-2 text-sm leading-relaxed text-sand-600">{{ message }}</p>

      <NuxtLink
        to="/sign-in"
        class="focus-ring mt-6 flex min-h-11 w-full items-center justify-center rounded-xl bg-cta px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-cta-hover hover:shadow-md"
      >
        Try again
      </NuxtLink>
      <NuxtLink
        to="/"
        class="focus-ring mt-2 flex min-h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-medium text-sand-600 transition-colors hover:text-sand-900"
      >
        Back to home
      </NuxtLink>

      <p class="mt-4 font-mono text-xs text-sand-400">{{ code }}</p>
    </div>
  </div>
</template>
