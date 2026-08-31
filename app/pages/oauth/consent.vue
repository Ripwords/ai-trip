<script setup lang="ts">
// A consent screen must not offer navigation that abandons the authorization
// mid-flow, and the default layout carries both a home link and its own sign-in
// button hardcoded to /dashboard. Every exit on this page is deliberate.
definePageMeta({ layout: false })

useSeoMeta({
  title: "Authorize app",
  description: "Review what an app is asking to do with your AI Trip account.",
})

interface PublicClient {
  client_id: string
  client_name?: string
  client_uri?: string
  logo_uri?: string
}

type ConsentStatus =
  | { kind: "no-request" }
  | { kind: "ready" }
  | { kind: "deciding"; accept: boolean }
  /** The server refused the request itself: bad or expired signature. */
  | { kind: "rejected"; message: string }
  /** The decision never reached the server, or came back unrecognisable. */
  | { kind: "failed"; message: string; accept: boolean }

const route = useRoute()

const clientId = computed(() => String(route.query.client_id ?? ""))
const scopes = computed(() =>
  parseScopeParam(String(route.query.scope ?? "")).map((scope) => {
    const { label, description, sensitive } = describeScope(scope)
    return { scope, label, description, sensitive }
  }),
)

const status = ref<ConsentStatus>(clientId.value ? { kind: "ready" } : { kind: "no-request" })
const deciding = computed(() => status.value.kind === "deciding")
const decidingAccept = computed(() =>
  status.value.kind === "deciding" ? status.value.accept : null,
)
const retryAccept = computed(() => status.value.kind === "failed" && status.value.accept)
const errorMessage = computed(() =>
  status.value.kind === "rejected" || status.value.kind === "failed" ? status.value.message : "",
)

// useRequestFetch forwards cookies during SSR; plain useFetch does not, and both
// of these lookups need the session. Neither is load-bearing, so a 404, a
// missing session or an outage resolves to an empty string rather than
// stranding someone mid-authorization.
const requestFetch = useRequestFetch()
const { data: context } = await useAsyncData("oauth-consent-context", async () => {
  const [client, session] = await Promise.all([
    clientId.value
      ? requestFetch<PublicClient>("/api/auth/oauth2/public-client", {
          query: { client_id: clientId.value },
        }).catch(() => null)
      : Promise.resolve(null),
    requestFetch<{ user?: { email?: string } }>("/api/auth/get-session").catch(() => null),
  ])
  return {
    clientName: client?.client_name?.trim() ?? "",
    accountEmail: session?.user?.email ?? "",
  }
})

const clientName = computed(() => context.value?.clientName ?? "")
const accountEmail = computed(() => context.value?.accountEmail ?? "")
const clientLabel = computed(() => clientName.value || clientId.value)

// Captured verbatim, never rebuilt from route.query. Canonicalisation means the
// signature covers the decoded key/value multiset, so encoding and order do not
// matter, but the repeated `resource` and `ba_param` entries do, and flattening
// the query into an object would drop them.
const rawQuery = ref("")
onMounted(() => {
  rawQuery.value = window.location.search.replace(/^\?/, "")
})

// /oauth2/authorize ignores a stale sig and exp and mints a fresh pair, so
// re-entering it is the way back from an expired request.
const startOverHref = computed(() => `${AUTHORIZE_ENDPOINT}?${rawQuery.value}`)

async function decide(accept: boolean) {
  if (status.value.kind === "deciding") return
  status.value = { kind: "deciding", accept }

  try {
    const result = await $fetch<{ redirect: boolean; url: string }>("/api/auth/oauth2/consent", {
      method: "POST",
      body: { accept, oauth_query: rawQuery.value },
    })
    // Denial takes this same path: it answers 200 with the client's redirect_uri
    // carrying error=access_denied, never a 302. The field is `url`, not the
    // `redirect_uri` the package's own OpenAPI metadata advertises.
    await navigateTo(result.url, { external: true })
  } catch (e: unknown) {
    const err = e as { data?: { error?: string; error_description?: string } }
    if (typeof err.data?.error === "string") {
      status.value = {
        kind: "rejected",
        message: humanMessage(
          err.data.error_description,
          "This authorization request has expired or is no longer valid.",
        ),
      }
    } else {
      status.value = {
        kind: "failed",
        accept,
        message: humanMessage(
          err.data?.error_description,
          "We couldn't reach AI Trip to record your decision. Check your connection and try again.",
        ),
      }
    }
  }
}
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center justify-center gap-8 bg-sand-50 px-4 py-12">
    <div class="flex items-center gap-2">
      <NuxtImg src="/image.png" alt="" class="h-8 w-8 rounded-lg" loading="eager" />
      <span class="font-display text-lg text-sand-900">AI Trip</span>
    </div>

    <div class="w-full max-w-md rounded-2xl border border-sand-200 bg-white p-6">
      <div v-if="status.kind === 'no-request'" role="alert" class="space-y-4 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sand-100">
          <Icon name="lucide:link-2-off" class="h-6 w-6 text-sand-500" aria-hidden="true" />
        </div>
        <h1 class="font-display text-xl text-sand-900">Nothing to authorize</h1>
        <p class="text-sm leading-relaxed text-sand-600">
          This link is missing its authorization request, so there is nothing to approve. Start
          again from the app you were connecting.
        </p>
        <NuxtLink
          to="/dashboard"
          class="inline-flex min-h-11 items-center justify-center text-sm text-terra-600 underline"
        >
          Go to dashboard
        </NuxtLink>
      </div>

      <div v-else-if="status.kind === 'rejected'" role="alert" class="space-y-4 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
          <Icon name="lucide:triangle-alert" class="h-6 w-6 text-amber-600" aria-hidden="true" />
        </div>
        <h1 class="font-display text-xl text-sand-900">This request is no longer valid</h1>
        <p class="text-sm leading-relaxed text-sand-600">{{ errorMessage }}</p>
        <div class="flex flex-col items-center gap-1">
          <a
            v-if="clientId"
            :href="startOverHref"
            class="inline-flex min-h-11 items-center justify-center text-sm text-terra-600 underline"
          >
            Start over
          </a>
          <NuxtLink
            to="/dashboard"
            class="inline-flex min-h-11 items-center justify-center text-sm text-terra-600 underline"
          >
            Go to dashboard
          </NuxtLink>
        </div>
      </div>

      <div v-else-if="status.kind === 'failed'" role="alert" class="space-y-4 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-terra-50">
          <Icon name="lucide:wifi-off" class="h-6 w-6 text-terra-600" aria-hidden="true" />
        </div>
        <h1 class="font-display text-xl text-sand-900">We couldn't save your decision</h1>
        <p class="text-sm leading-relaxed text-sand-600">{{ errorMessage }}</p>
        <button
          type="button"
          class="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cta px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-cta-hover hover:shadow-md"
          @click="decide(retryAccept)"
        >
          <Icon name="lucide:rotate-ccw" class="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
        <NuxtLink
          to="/dashboard"
          class="inline-flex min-h-11 items-center justify-center text-sm text-terra-600 underline"
        >
          Go to dashboard
        </NuxtLink>
      </div>

      <div v-else>
        <h1 class="font-display text-xl text-sand-900">Authorize this app</h1>
        <p class="mt-2 text-sm leading-relaxed text-sand-600">
          <span v-if="clientName" class="font-medium text-sand-900">{{ clientLabel }}</span>
          <span v-else class="break-all font-mono text-sand-900">{{ clientLabel }}</span>
          is asking for access to your AI Trip account.
        </p>
        <p v-if="accountEmail" class="mt-1 text-sm text-sand-500">
          Signed in as {{ accountEmail }}
        </p>

        <p class="mt-5 text-sm font-medium text-sand-900">
          If you allow it, this app will be able to:
        </p>

        <ul v-if="scopes.length" class="mt-3 space-y-2">
          <li
            v-for="row in scopes"
            :key="row.scope"
            class="rounded-xl border p-3"
            :class="row.sensitive ? 'border-amber-200 bg-amber-50' : 'border-sand-200'"
          >
            <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-sand-900">
              <span class="break-words">{{ row.label }}</span>
              <span
                v-if="row.sensitive"
                class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
              >
                <Icon name="lucide:shield-alert" class="h-3 w-3" aria-hidden="true" />
                Sensitive
              </span>
            </p>
            <p class="mt-1 break-words text-sm leading-relaxed text-sand-600">
              {{ row.description }}
            </p>
          </li>
        </ul>
        <p v-else class="mt-3 text-sm text-sand-600">
          This app asked for no permissions beyond confirming that you have an AI Trip account.
        </p>

        <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            :disabled="deciding"
            class="focus-ring inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-sand-200 px-5 text-sm font-medium text-sand-700 transition hover:bg-sand-100 disabled:cursor-not-allowed disabled:opacity-70"
            @click="decide(false)"
          >
            <Icon
              v-if="decidingAccept === false"
              name="lucide:loader"
              class="h-4 w-4 animate-spin"
              aria-hidden="true"
            />
            Deny
          </button>
          <button
            type="button"
            :disabled="deciding"
            class="focus-ring inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-cta px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-cta-hover hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
            @click="decide(true)"
          >
            <Icon
              v-if="decidingAccept === true"
              name="lucide:loader"
              class="h-4 w-4 animate-spin"
              aria-hidden="true"
            />
            Allow
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
