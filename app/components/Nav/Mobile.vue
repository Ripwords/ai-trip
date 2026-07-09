<script setup lang="ts">
const tabs = [
  { label: "Trips", icon: "lucide:map", to: "/dashboard" },
  { label: "Explore", icon: "lucide:globe", to: "/explore" },
  { label: "Flights", icon: "lucide:plane", to: "/flights" },
  { label: "Passport", icon: "lucide:stamp", to: "/passport" },
]

const { open: keyboardOpen } = useKeyboardOpen()
</script>

<template>
  <nav
    v-show="!keyboardOpen"
    class="fixed bottom-0 left-0 z-50 w-full border-t border-sand-200/50 bg-sand-50 sm:hidden"
    style="
      padding-bottom: env(safe-area-inset-bottom);
      padding-left: env(safe-area-inset-left);
      padding-right: env(safe-area-inset-right);
    "
  >
    <ul class="flex h-16 flex-row items-center justify-around">
      <li v-for="tab in tabs" :key="tab.to">
        <NuxtLink
          :to="tab.to"
          class="group relative flex min-h-11 flex-col items-center justify-center px-3 py-1 font-normal text-sand-500 transition-colors hover:text-sand-700"
          active-class="!font-semibold !text-terra-500"
        >
          <span
            class="absolute top-0 h-0.5 w-8 rounded-full bg-terra-500 opacity-0 transition-opacity group-[.router-link-active]:opacity-100"
          />
          <Icon :name="tab.icon" class="mb-0.5 text-xl" />
          <span class="text-xs">{{ tab.label }}</span>
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
