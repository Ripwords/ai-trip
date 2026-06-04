<script setup lang="ts">
import type { BriefingChip, BriefingSignal, PreTripBriefing } from "../utils/dashboard-briefing"

defineProps<{
  briefing: PreTripBriefing
}>()

function chipClass(chip: BriefingChip): string {
  if (chip.tone === "warn") {
    return "border-terra-100 bg-terra-50 text-terra-600"
  }
  if (chip.tone === "good") {
    return "border-forest-100 bg-forest-50 text-forest-700"
  }
  return "border-sand-200 bg-white/75 text-sand-700 dark:bg-white/10 dark:text-sand-800"
}

function signalClass(signal: BriefingSignal): string {
  if (signal.tone === "warn") {
    return "bg-terra-50 hover:bg-terra-100/70 dark:bg-terra-100/80 dark:hover:bg-terra-200/70"
  }
  if (signal.tone === "good") {
    return "bg-forest-50 hover:bg-forest-100/70 dark:bg-forest-100/80 dark:hover:bg-forest-200/70"
  }
  return "bg-ocean-50 hover:bg-ocean-100/70 dark:bg-ocean-100/80 dark:hover:bg-ocean-200/70"
}

function iconClass(signal: BriefingSignal): string {
  if (signal.tone === "warn") return "bg-terra-100 text-terra-600"
  if (signal.tone === "good") return "bg-forest-100 text-forest-700"
  return "bg-ocean-100 text-ocean-700"
}
</script>

<template>
  <section class="grid gap-3 lg:grid-cols-[minmax(0,1.32fr)_minmax(260px,0.68fr)]">
    <NuxtLink
      :to="`/trips/${briefing.tripId}`"
      class="briefing-hero-surface group relative min-h-[230px] overflow-hidden rounded-2xl p-5 transition hover:shadow-xl hover:shadow-sand-900/10 sm:p-6"
    >
      <div class="briefing-orbit absolute -bottom-16 -right-12 h-48 w-48 rounded-full" />
      <div class="relative z-10 flex h-full flex-col">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-terra-500">
              {{ briefing.journeyLabel }}
            </p>
            <h2 class="mt-2 font-display text-3xl leading-none text-sand-900 sm:text-4xl">
              {{ briefing.destination }}
              <span class="text-terra-500">
                <template v-if="briefing.daysUntil === 0">today</template>
                <template v-else-if="briefing.daysUntil === 1">tomorrow</template>
                <template v-else>in {{ briefing.daysUntil }} days</template>
              </span>
            </h2>
            <p class="mt-2 flex flex-wrap items-center gap-x-1 text-sm text-sand-600">
              <NuxtTime
                :datetime="briefing.startDate + 'T00:00:00'"
                locale="en-US"
                weekday="short"
                month="short"
                day="numeric"
              />
              <span class="mx-1 text-sand-300">-</span>
              <NuxtTime
                :datetime="briefing.endDate + 'T00:00:00'"
                locale="en-US"
                weekday="short"
                month="short"
                day="numeric"
              />
            </p>
          </div>
          <div
            class="rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-sand-700 shadow-sm backdrop-blur dark:bg-white/10 dark:text-sand-800"
          >
            Depart
            <NuxtTime
              :datetime="briefing.departureDate + 'T00:00:00'"
              locale="en-US"
              month="short"
              day="numeric"
            />
          </div>
        </div>

        <p class="mt-5 max-w-2xl text-sm leading-6 text-sand-700 sm:text-[15px]">
          {{ briefing.summary }}
        </p>

        <div class="mt-auto flex flex-wrap gap-2 pt-8">
          <span
            v-for="chip in briefing.chips"
            :key="chip.label"
            class="inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur"
            :class="chipClass(chip)"
          >
            {{ chip.label }}
          </span>
        </div>
      </div>
    </NuxtLink>

    <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-1 sm:gap-3">
      <template v-for="signal in briefing.signals" :key="signal.key">
        <NuxtLink
          v-if="signal.to"
          :to="signal.to"
          class="group flex items-center justify-center gap-1.5 overflow-hidden rounded-full px-2 py-1.5 text-[11px] font-semibold text-sand-900 transition sm:min-h-[72px] sm:justify-start sm:items-start sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-4 sm:text-sm sm:shadow-sm sm:shadow-sand-900/5 sm:hover:shadow-md sm:hover:shadow-sand-900/10"
          :class="signalClass(signal)"
        >
          <span
            class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9 sm:rounded-xl"
            :class="iconClass(signal)"
          >
            <Icon :name="signal.icon" class="h-2.5 w-2.5 sm:h-4 sm:w-4" />
          </span>
          <span
            class="min-w-0 truncate leading-none sm:flex-1 sm:overflow-visible sm:leading-normal"
          >
            <span class="sm:block">{{ signal.title }}</span>
            <span class="mt-1 hidden text-xs font-normal leading-5 text-sand-600 sm:block">{{
              signal.detail
            }}</span>
          </span>
          <span class="ml-auto mt-1 hidden h-4 w-4 shrink-0 sm:block">
            <Icon
              name="lucide:chevron-right"
              class="h-4 w-4 text-sand-400 transition group-hover:translate-x-0.5"
            />
          </span>
        </NuxtLink>

        <div
          v-else
          class="flex items-center justify-center gap-1.5 overflow-hidden rounded-full px-2 py-1.5 text-[11px] font-semibold text-sand-900 sm:min-h-[72px] sm:justify-start sm:items-start sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-4 sm:text-sm sm:shadow-sm sm:shadow-sand-900/5"
          :class="signalClass(signal)"
        >
          <span
            class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9 sm:rounded-xl"
            :class="iconClass(signal)"
          >
            <Icon :name="signal.icon" class="h-2.5 w-2.5 sm:h-4 sm:w-4" />
          </span>
          <span
            class="min-w-0 truncate leading-none sm:flex-1 sm:overflow-visible sm:leading-normal"
          >
            <span class="sm:block">{{ signal.title }}</span>
            <span class="mt-1 hidden text-xs font-normal leading-5 text-sand-600 sm:block">{{
              signal.detail
            }}</span>
          </span>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.briefing-hero-surface {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--color-terra-500) 13%, var(--color-sand-50)),
    color-mix(in srgb, var(--color-ocean-500) 13%, var(--color-sand-50)) 54%,
    var(--color-sand-50)
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.38),
    0 16px 42px rgba(61, 51, 40, 0.08);
}

.briefing-orbit {
  border: 1px solid color-mix(in srgb, var(--color-sand-500) 24%, transparent);
}

.dark .briefing-hero-surface {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--color-terra-500) 15%, var(--color-sand-50)),
    color-mix(in srgb, var(--color-ocean-500) 16%, var(--color-sand-50)) 58%,
    var(--color-sand-50)
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 18px 46px rgba(0, 0, 0, 0.24);
}

.dark .briefing-orbit {
  border-color: color-mix(in srgb, var(--color-sand-500) 20%, transparent);
}
</style>
