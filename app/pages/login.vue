<script setup lang="ts">
import { authClient } from "../lib/auth-client";

useHead({ title: "Log in — AI Trip" });

const { data: session } = await authClient.useSession(useFetch);
if (session.value?.user) {
  navigateTo("/dashboard");
}

const email = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

async function handleLogin() {
  error.value = "";
  loading.value = true;

  const { error: authError } = await authClient.signIn.email({
    email: email.value,
    password: password.value,
  });

  loading.value = false;

  if (authError) {
    error.value = authError.message ?? "Login failed";
    return;
  }

  navigateTo("/dashboard");
}
</script>

<template>
  <div class="relative flex min-h-[85vh] items-center justify-center overflow-hidden px-4">
    <!-- Background -->
    <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-sand-50 via-sand-100 to-terra-50/30" aria-hidden="true" />
    <div class="pointer-events-none absolute -right-40 top-20 h-[400px] w-[400px] rounded-full bg-terra-100/40 blur-[100px]" aria-hidden="true" />

    <div class="relative z-10 w-full max-w-sm">
      <div class="rounded-2xl border border-sand-200/80 bg-white/80 p-8 shadow-xl backdrop-blur-sm">
        <div class="text-center">
          <NuxtLink to="/" class="font-display text-2xl text-terra-600">AI Trip</NuxtLink>
          <h1 class="mt-3 font-display text-xl text-sand-900">Welcome back</h1>
          <p class="mt-1 text-sm text-sand-500">
            Don't have an account?
            <NuxtLink to="/register" class="font-medium text-terra-600 transition hover:text-terra-700">
              Sign up
            </NuxtLink>
          </p>
        </div>

        <form class="mt-6 space-y-4" @submit.prevent="handleLogin">
          <div>
            <label for="email" class="block text-xs font-medium uppercase tracking-wide text-sand-500">
              Email
            </label>
            <input
              id="email"
              v-model="email"
              type="email"
              required
              class="input-focus mt-1.5 block w-full rounded-xl border border-sand-200 bg-sand-50/50 px-4 py-2.5 text-sm text-sand-900 placeholder:text-sand-400"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label for="password" class="block text-xs font-medium uppercase tracking-wide text-sand-500">
              Password
            </label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              class="input-focus mt-1.5 block w-full rounded-xl border border-sand-200 bg-sand-50/50 px-4 py-2.5 text-sm text-sand-900 placeholder:text-sand-400"
              placeholder="Your password"
            />
          </div>

          <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

          <button
            type="submit"
            :disabled="loading"
            class="mt-2 w-full rounded-xl bg-terra-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-terra-500/20 transition-all hover:bg-terra-600 hover:shadow-lg disabled:opacity-50"
          >
            {{ loading ? "Logging in..." : "Log in" }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
