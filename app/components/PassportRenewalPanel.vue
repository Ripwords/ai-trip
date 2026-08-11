<script setup lang="ts">
import { buildPassportRenewals } from "../utils/passport-renewal"
import type { PassportRenewalTone, RenewalPassport } from "../utils/passport-renewal"

const props = withDefaults(
  defineProps<{
    passports: RenewalPassport[] | null | undefined
    loading?: boolean
  }>(),
  { loading: false },
)

const renewals = computed(() => buildPassportRenewals(props.passports))

const TONE_CLASS: Record<PassportRenewalTone, string> = {
  good: "bg-sand-100 text-sand-700",
  info: "bg-ocean-50 text-ocean-700",
  warn: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-600",
}
</script>

<template>
  <section class="rounded-2xl border border-sand-200 bg-white/70 p-5">
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h2 class="font-display text-lg text-sand-900">Passport documents</h2>
      <NuxtLink to="/settings" class="text-xs font-semibold text-terra-600 hover:text-terra-700">
        Manage
      </NuxtLink>
    </div>

    <div v-if="loading && !renewals.length" class="h-16 animate-pulse rounded-xl bg-sand-100" />

    <p v-else-if="!renewals.length" class="text-sm text-sand-500">
      No passports saved yet.
      <NuxtLink to="/settings" class="font-semibold text-terra-600 hover:text-terra-700">
        Add one in settings
      </NuxtLink>
      to track expiry and renewal dates.
    </p>

    <ul v-else class="divide-y divide-sand-100">
      <li
        v-for="renewal in renewals"
        :key="renewal.countryCode"
        class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
      >
        <PassportCover :country-code="renewal.countryCode" :width="44" />

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="font-medium text-sand-900">{{ renewal.countryName }}</p>
            <span
              v-if="renewal.isDefault"
              class="rounded-full bg-terra-50 px-1.5 py-0.5 text-[10px] font-medium text-terra-600"
            >
              Default
            </span>
          </div>
          <p class="mt-0.5 text-xs text-sand-500">{{ renewal.detail }}</p>
        </div>

        <dl class="flex items-center gap-5 tabular-nums">
          <div>
            <dt class="text-[10px] font-semibold uppercase tracking-[0.14em] text-sand-500">
              Expires
            </dt>
            <dd class="mt-0.5 text-sm text-sand-800">
              <NuxtTime
                v-if="renewal.expiryDate"
                :datetime="renewal.expiryDate + 'T00:00:00'"
                locale="en-US"
                month="short"
                day="numeric"
                year="numeric"
              />
              <span v-else class="text-sand-400">—</span>
            </dd>
          </div>
          <div>
            <dt class="text-[10px] font-semibold uppercase tracking-[0.14em] text-sand-500">
              Renew by
            </dt>
            <dd class="mt-0.5 text-sm text-sand-800">
              <NuxtTime
                v-if="renewal.recommendedRenewalDate"
                :datetime="renewal.recommendedRenewalDate + 'T00:00:00'"
                locale="en-US"
                month="short"
                day="numeric"
                year="numeric"
              />
              <span v-else class="text-sand-400">—</span>
            </dd>
          </div>
        </dl>

        <span
          class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
          :class="TONE_CLASS[renewal.tone]"
        >
          {{ renewal.headline }}
        </span>
      </li>
    </ul>
  </section>
</template>
