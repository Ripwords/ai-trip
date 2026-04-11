<script setup lang="ts">
useSeoMeta({
  title: "Plan Your Trip with AI",
  description:
    "AI finds hidden gems and real places verified by Google Maps. No tourist traps — just authentic, editable itineraries.",
  ogTitle: "AI Trip — Plan Your Trip with AI",
  ogDescription:
    "AI-powered travel planner that finds hidden gems verified by Google Maps. Create authentic, editable itineraries in minutes.",
})

useSchemaOrg([
  defineWebSite({
    name: "AI Trip",
    description: "AI-powered travel itinerary planner with real places verified by Google Maps",
  }),
  defineWebPage({
    "@type": "WebPage",
    name: "AI Trip — Plan Your Trip with AI",
    description:
      "AI-powered travel planner that finds hidden gems verified by Google Maps. Create authentic, editable itineraries in minutes.",
  }),
])

// Authenticated users are redirected to /dashboard by auth middleware,
// so anyone seeing this page is a guest.

// Intersection observer for scroll-triggered animations
const visibleSections = reactive(new Set<number>())
const siteURL = useSiteConfig().url

onMounted(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const idx = Number(entry.target.getAttribute("data-section"))
        if (entry.isIntersecting) {
          visibleSections.add(idx)
        }
      }
    },
    { threshold: 0.15 },
  )
  document.querySelectorAll("[data-section]").forEach((el) => observer.observe(el))
})
</script>

<template>
  <div class="bg-sand-50">
    <!-- ═══════ HERO ═══════ -->
    <section class="relative min-h-[92vh] overflow-hidden">
      <!-- Ambient gradient orbs -->
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          class="absolute -right-32 -top-32 h-[500px] w-[500px] rounded-full bg-terra-200/30 blur-[120px]"
        />
        <div
          class="absolute -left-20 top-1/3 h-[400px] w-[400px] rounded-full bg-ocean-200/20 blur-[100px]"
        />
        <div
          class="absolute -bottom-20 right-1/4 h-[350px] w-[350px] rounded-full bg-forest-200/15 blur-[100px]"
        />
      </div>

      <!-- Dot grid -->
      <div
        class="pointer-events-none absolute inset-0 opacity-[0.03]"
        style="
          background-image: radial-gradient(circle, #3d3328 1px, transparent 1px);
          background-size: 32px 32px;
        "
        aria-hidden="true"
      />

      <div
        class="relative z-10 flex flex-col items-center justify-center px-6 pt-24 pb-16 text-center sm:pt-32 sm:pb-20"
      >
        <!-- Eyebrow -->
        <div
          class="inline-flex items-center gap-2 rounded-full border border-terra-200 bg-white/60 px-4 py-1.5 backdrop-blur-sm"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-terra-500 animate-pulse" />
          <span class="text-xs font-medium tracking-wide text-terra-700"
            >AI-Powered Travel Planning</span
          >
        </div>

        <!-- Main heading -->
        <h1
          class="mt-8 font-display text-5xl leading-[1.08] tracking-tight text-sand-900 sm:text-7xl lg:text-8xl"
        >
          Plan trips that<br />
          <span class="text-gradient">feel local</span>
        </h1>

        <!-- Subheading -->
        <p class="mx-auto mt-6 max-w-lg text-base leading-relaxed text-sand-600 sm:text-lg">
          AI finds hidden gems and real places verified by Google Maps. No tourist traps — just
          authentic, editable itineraries.
        </p>

        <!-- CTA -->
        <div class="mt-10 flex items-center gap-4">
          <NuxtLink
            to="/login"
            class="group relative overflow-hidden rounded-xl bg-terra-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-terra-500/25 transition-all hover:bg-terra-600 hover:shadow-xl hover:shadow-terra-500/30"
          >
            <span class="relative z-10">{{ "Get started free" }}</span>
          </NuxtLink>
        </div>

        <!-- Feature pills -->
        <div class="mt-12 flex flex-wrap items-center justify-center gap-3">
          <div
            class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-medium text-sand-700 backdrop-blur-sm border border-sand-200/60"
          >
            <Icon name="lucide:map-pin" class="h-3.5 w-3.5 text-terra-500" />
            Google Maps verified
          </div>
          <div
            class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-medium text-sand-700 backdrop-blur-sm border border-sand-200/60"
          >
            <Icon name="lucide:sparkles" class="h-3.5 w-3.5 text-terra-500" />
            AI-powered suggestions
          </div>
          <div
            class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-medium text-sand-700 backdrop-blur-sm border border-sand-200/60"
          >
            <Icon name="lucide:heart" class="h-3.5 w-3.5 text-terra-500" />
            Local favorites first
          </div>
          <div
            class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-medium text-sand-700 backdrop-blur-sm border border-sand-200/60"
          >
            <Icon name="lucide:plane" class="h-3.5 w-3.5 text-terra-500" />
            Flight tracking
          </div>
        </div>
      </div>

      <!-- Hero mock: floating app preview -->
      <div class="relative z-10 mx-auto max-w-5xl px-6 pb-20">
        <div
          class="relative rounded-2xl border border-sand-200/80 bg-white shadow-2xl shadow-sand-900/8 overflow-hidden"
        >
          <!-- Browser chrome -->
          <div class="flex items-center gap-2 border-b border-sand-100 bg-sand-50 px-4 py-2.5">
            <span class="h-2.5 w-2.5 rounded-full bg-terra-300" />
            <span class="h-2.5 w-2.5 rounded-full bg-sand-300" />
            <span class="h-2.5 w-2.5 rounded-full bg-forest-300" />
            <div
              class="ml-3 flex-1 rounded-md bg-sand-100 px-3 py-1 text-[11px] text-sand-400 font-mono"
            >
              {{ siteURL.slice(8) }}/trips/tokyo-adventure
            </div>
          </div>
          <!-- Mock app content: Trip detail -->
          <div class="p-6 sm:p-8">
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="font-display text-2xl text-sand-900">Tokyo Adventure</h3>
                  <span
                    class="rounded-full bg-forest-50 px-2.5 py-0.5 text-xs font-medium text-forest-700"
                    >Upcoming</span
                  >
                </div>
                <p class="mt-1 flex items-center gap-1.5 text-sm text-sand-500">
                  <Icon name="lucide:calendar" class="h-3.5 w-3.5" />
                  Apr 15 - Apr 22, 2026
                  <span class="text-sand-300">·</span>
                  7 days
                </p>
              </div>
              <div class="hidden sm:flex gap-2">
                <div
                  class="rounded-xl border border-sand-200 bg-sand-50 px-4 py-2 text-center min-w-[80px]"
                >
                  <p class="font-display text-xl text-sand-900">7</p>
                  <p class="text-[10px] text-sand-500">Days</p>
                </div>
                <div
                  class="rounded-xl border border-sand-200 bg-sand-50 px-4 py-2 text-center min-w-[80px]"
                >
                  <p class="font-display text-xl text-sand-900">18</p>
                  <p class="text-[10px] text-sand-500">Activities</p>
                </div>
                <div
                  class="rounded-xl border border-sand-200 bg-sand-50 px-4 py-2 text-center min-w-[80px]"
                >
                  <p class="font-display text-xl text-terra-600">$1,240</p>
                  <p class="text-[10px] text-sand-500">Est. Cost</p>
                </div>
              </div>
            </div>

            <!-- Mock day section -->
            <div class="mt-6 space-y-3">
              <div class="flex items-center gap-3">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white"
                >
                  1
                </div>
                <div>
                  <h4 class="text-sm font-semibold text-sand-900">Day 1 — Arrival & Shibuya</h4>
                  <p class="text-xs text-sand-400">Tuesday, Apr 15</p>
                </div>
              </div>

              <!-- Mock activity cards -->
              <div class="ml-11 space-y-2.5">
                <div class="rounded-xl border border-sand-200 bg-white p-4 transition">
                  <div class="flex items-start gap-3">
                    <span
                      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-terra-500 text-[10px] font-bold text-white"
                      >1</span
                    >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <h5 class="text-sm font-semibold text-sand-900">Senso-ji Temple</h5>
                        <span
                          class="rounded-full bg-ocean-50 px-2 py-0.5 text-[10px] font-medium text-ocean-700"
                          >Attraction</span
                        >
                        <span
                          class="rounded-full bg-terra-50 px-2 py-0.5 text-[10px] font-semibold text-terra-700"
                        >
                          9:00 AM
                        </span>
                      </div>
                      <p class="mt-1 text-xs text-sand-500 line-clamp-1">
                        Tokyo's oldest temple with the iconic Kaminarimon gate. Explore Nakamise
                        shopping street.
                      </p>
                      <div class="mt-2 flex items-center gap-3 text-xs text-sand-400">
                        <span class="flex items-center gap-1 text-ocean-600">
                          <Icon name="lucide:map-pin" class="h-3 w-3" />
                          Asakusa, Taito City
                        </span>
                        <span>2h</span>
                        <span>Free</span>
                        <span class="flex items-center gap-0.5">
                          <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                          4.6
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="rounded-xl border border-sand-200 bg-white p-4 transition">
                  <div class="flex items-start gap-3">
                    <span
                      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-terra-500 text-[10px] font-bold text-white"
                      >2</span
                    >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <h5 class="text-sm font-semibold text-sand-900">Ichiran Ramen Shibuya</h5>
                        <span
                          class="rounded-full bg-terra-50 px-2 py-0.5 text-[10px] font-medium text-terra-700"
                          >Restaurant</span
                        >
                        <span
                          class="rounded-full bg-terra-50 px-2 py-0.5 text-[10px] font-semibold text-terra-700"
                        >
                          12:30 PM
                        </span>
                      </div>
                      <p class="mt-1 text-xs text-sand-500 line-clamp-1">
                        Famous tonkotsu ramen chain with individual dining booths — a unique solo
                        dining experience.
                      </p>
                      <div class="mt-2 flex items-center gap-3 text-xs text-sand-400">
                        <span class="flex items-center gap-1 text-ocean-600">
                          <Icon name="lucide:map-pin" class="h-3 w-3" />
                          Shibuya, Tokyo
                        </span>
                        <span>1h</span>
                        <span>$15</span>
                        <span class="flex items-center gap-0.5">
                          <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                          4.4
                        </span>
                        <span class="text-forest-600 font-medium">$$</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="rounded-xl border border-sand-200 bg-white p-4 transition">
                  <div class="flex items-start gap-3">
                    <span
                      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-terra-500 text-[10px] font-bold text-white"
                      >3</span
                    >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <h5 class="text-sm font-semibold text-sand-900">
                          Shibuya Crossing & Hachiko
                        </h5>
                        <span
                          class="rounded-full bg-ocean-50 px-2 py-0.5 text-[10px] font-medium text-ocean-700"
                          >Attraction</span
                        >
                        <span
                          class="rounded-full bg-terra-50 px-2 py-0.5 text-[10px] font-semibold text-terra-700"
                        >
                          2:00 PM
                        </span>
                      </div>
                      <p class="mt-1 text-xs text-sand-500 line-clamp-1">
                        Walk the world's busiest pedestrian crossing and visit the Hachiko memorial
                        statue.
                      </p>
                      <div class="mt-2 flex items-center gap-3 text-xs text-sand-400">
                        <span class="flex items-center gap-1 text-ocean-600">
                          <Icon name="lucide:map-pin" class="h-3 w-3" />
                          Shibuya Station
                        </span>
                        <span>1h 30min</span>
                        <span>Free</span>
                        <span class="flex items-center gap-0.5">
                          <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                          4.7
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- Floating accent decorations -->
        <div
          class="absolute -bottom-4 -left-4 h-32 w-32 rounded-full bg-terra-200/20 blur-[60px]"
          aria-hidden="true"
        />
        <div
          class="absolute -right-6 -top-6 h-40 w-40 rounded-full bg-ocean-200/15 blur-[60px]"
          aria-hidden="true"
        />
      </div>
    </section>

    <!-- ═══════ FEATURE SECTIONS ═══════ -->

    <!-- Feature 1: AI Itinerary Generation -->
    <section data-section="0" class="relative overflow-hidden py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-6">
        <div class="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <!-- Text -->
          <div
            class="transition-all duration-700"
            :class="
              visibleSections.has(0) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            "
          >
            <div
              class="inline-flex items-center gap-2 rounded-full bg-terra-50 px-3 py-1 text-xs font-medium text-terra-700"
            >
              <Icon name="lucide:sparkles" class="h-3.5 w-3.5" />
              AI-Powered
            </div>
            <h2 class="mt-4 font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
              Tell AI where you want to go.
              <span class="text-gradient">It handles the rest.</span>
            </h2>
            <p class="mt-4 max-w-md text-base leading-relaxed text-sand-600">
              Describe your trip — destination, dates, budget, travel style. Our AI builds a
              day-by-day itinerary with real places, accurate costs, and local hidden gems.
            </p>
            <ul class="mt-6 space-y-3">
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Day-by-day structured itineraries with timing
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Cost estimates and budget tracking per activity
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Fully editable — add, remove, or rearrange anything
              </li>
            </ul>
          </div>

          <!-- Mock: Trip creation form -->
          <div
            class="transition-all duration-700 delay-200"
            :class="
              visibleSections.has(0) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
            "
          >
            <div
              class="rounded-2xl border border-sand-200/80 bg-white shadow-xl shadow-sand-900/5 overflow-hidden"
            >
              <div class="border-b border-sand-100 bg-sand-50 px-5 py-3">
                <h4 class="text-sm font-semibold text-sand-900">Plan a New Trip</h4>
              </div>
              <div class="space-y-4 p-5 sm:p-6">
                <div>
                  <label class="text-xs font-medium text-sand-600">Where do you want to go?</label>
                  <div
                    class="mt-1.5 flex items-center gap-2 rounded-xl border border-sand-200 bg-sand-50 px-3.5 py-2.5"
                  >
                    <Icon name="lucide:map-pin" class="h-4 w-4 text-terra-500" />
                    <span class="text-sm text-sand-900">Kyoto, Japan</span>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="text-xs font-medium text-sand-600">Start date</label>
                    <div
                      class="mt-1.5 flex items-center gap-2 rounded-xl border border-sand-200 bg-sand-50 px-3.5 py-2.5"
                    >
                      <Icon name="lucide:calendar" class="h-4 w-4 text-sand-400" />
                      <span class="text-sm text-sand-700">May 10, 2026</span>
                    </div>
                  </div>
                  <div>
                    <label class="text-xs font-medium text-sand-600">End date</label>
                    <div
                      class="mt-1.5 flex items-center gap-2 rounded-xl border border-sand-200 bg-sand-50 px-3.5 py-2.5"
                    >
                      <Icon name="lucide:calendar" class="h-4 w-4 text-sand-400" />
                      <span class="text-sm text-sand-700">May 16, 2026</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label class="text-xs font-medium text-sand-600">Budget</label>
                  <div
                    class="mt-1.5 flex items-center gap-2 rounded-xl border border-sand-200 bg-sand-50 px-3.5 py-2.5"
                  >
                    <Icon name="lucide:dollar-sign" class="h-4 w-4 text-sand-400" />
                    <span class="text-sm text-sand-700">$2,000</span>
                  </div>
                </div>
                <div>
                  <label class="text-xs font-medium text-sand-600">Travel style</label>
                  <div class="mt-1.5 flex flex-wrap gap-2">
                    <span class="rounded-full bg-terra-500 px-3 py-1 text-xs font-medium text-white"
                      >Cultural</span
                    >
                    <span class="rounded-full bg-ocean-500 px-3 py-1 text-xs font-medium text-white"
                      >Foodie</span
                    >
                    <span
                      class="rounded-full border border-sand-200 bg-white px-3 py-1 text-xs font-medium text-sand-600"
                      >Adventure</span
                    >
                    <span
                      class="rounded-full border border-sand-200 bg-white px-3 py-1 text-xs font-medium text-sand-600"
                      >Relaxation</span
                    >
                  </div>
                </div>
                <div
                  class="flex items-center gap-2 rounded-xl bg-terra-500 px-5 py-3 text-sm font-semibold text-white justify-center"
                >
                  <Icon name="lucide:sparkles" class="h-4 w-4" />
                  Generate Itinerary with AI
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature 2: Google Maps Verified -->
    <section data-section="1" class="relative overflow-hidden bg-sand-100/50 py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-6">
        <div class="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <!-- Mock: Activity card with map data -->
          <div
            class="order-2 lg:order-1 transition-all duration-700 delay-200"
            :class="
              visibleSections.has(1) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
            "
          >
            <div class="space-y-3">
              <!-- Mock verified activity -->
              <div
                class="rounded-2xl border border-sand-200/80 bg-white p-5 shadow-lg shadow-sand-900/5"
              >
                <div class="flex items-start gap-3">
                  <span
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white"
                    >1</span
                  >
                  <div class="flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h5 class="font-semibold text-sand-900">Fushimi Inari Taisha</h5>
                      <span
                        class="rounded-full bg-ocean-50 px-2.5 py-0.5 text-[10px] font-medium text-ocean-700"
                        >Attraction</span
                      >
                    </div>
                    <p class="mt-1 text-sm text-sand-500">
                      Thousands of vermillion torii gates winding through the forested mountain.
                    </p>
                    <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-sand-400">
                      <span class="flex items-center gap-1 text-ocean-600">
                        <Icon name="lucide:map-pin" class="h-3 w-3" />
                        68 Fukakusa, Fushimi-ku
                      </span>
                      <span class="flex items-center gap-0.5">
                        <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                        <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                        <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                        <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                        <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                        4.8
                      </span>
                      <span>3h</span>
                      <span>Free</span>
                    </div>
                    <!-- Verified badge -->
                    <div
                      class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-forest-50 px-3 py-1 text-[11px] font-medium text-forest-700"
                    >
                      <Icon name="lucide:shield-check" class="h-3 w-3" />
                      Verified via Google Maps
                    </div>
                  </div>
                </div>
              </div>

              <!-- Mock verified activity 2 -->
              <div
                class="rounded-2xl border border-sand-200/80 bg-white p-5 shadow-lg shadow-sand-900/5"
              >
                <div class="flex items-start gap-3">
                  <span
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white"
                    >2</span
                  >
                  <div class="flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h5 class="font-semibold text-sand-900">Nishiki Market</h5>
                      <span
                        class="rounded-full bg-terra-50 px-2.5 py-0.5 text-[10px] font-medium text-terra-700"
                        >Restaurant</span
                      >
                    </div>
                    <p class="mt-1 text-sm text-sand-500">
                      "Kyoto's Kitchen" — five blocks of fresh food, street snacks, and local
                      ingredients.
                    </p>
                    <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-sand-400">
                      <span class="flex items-center gap-1 text-ocean-600">
                        <Icon name="lucide:map-pin" class="h-3 w-3" />
                        Nishikikoji-dori, Nakagyo
                      </span>
                      <span class="flex items-center gap-0.5">
                        <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                        <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                        <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                        <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                        <Icon name="lucide:star" class="h-3 w-3 text-sand-300" />
                        4.3
                      </span>
                      <span>2h</span>
                      <span>$20</span>
                      <span class="text-forest-600 font-medium">$$</span>
                    </div>
                    <div
                      class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-forest-50 px-3 py-1 text-[11px] font-medium text-forest-700"
                    >
                      <Icon name="lucide:shield-check" class="h-3 w-3" />
                      Verified via Google Maps
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Text -->
          <div
            class="order-1 lg:order-2 transition-all duration-700"
            :class="
              visibleSections.has(1) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            "
          >
            <div
              class="inline-flex items-center gap-2 rounded-full bg-forest-50 px-3 py-1 text-xs font-medium text-forest-700"
            >
              <Icon name="lucide:shield-check" class="h-3.5 w-3.5" />
              Google Maps Verified
            </div>
            <h2 class="mt-4 font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
              Every place is
              <span class="text-gradient">real and verified.</span>
            </h2>
            <p class="mt-4 max-w-md text-base leading-relaxed text-sand-600">
              No hallucinated restaurants or fake attractions. Every location is validated against
              Google Maps with real ratings, addresses, opening hours, and photos.
            </p>
            <ul class="mt-6 space-y-3">
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Real ratings and reviews from Google
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Accurate addresses and opening hours
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                One-tap navigation to Google Maps
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature 3: Expense Tracking & Budget -->
    <section data-section="2" class="relative overflow-hidden py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-6">
        <div class="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <!-- Text -->
          <div
            class="transition-all duration-700"
            :class="
              visibleSections.has(2) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            "
          >
            <div
              class="inline-flex items-center gap-2 rounded-full bg-ocean-50 px-3 py-1 text-xs font-medium text-ocean-700"
            >
              <Icon name="lucide:wallet" class="h-3.5 w-3.5" />
              Budget Tracking
            </div>
            <h2 class="mt-4 font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
              Stay on budget.
              <span class="text-gradient">Spend smarter.</span>
            </h2>
            <p class="mt-4 max-w-md text-base leading-relaxed text-sand-600">
              Track expenses by category, see running totals against your budget, and log actual
              costs as you travel. No surprises at the end of the trip.
            </p>
            <ul class="mt-6 space-y-3">
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Estimated costs per activity from AI
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Log actual spend and compare to estimates
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Category breakdown with visual progress bars
              </li>
            </ul>
          </div>

          <!-- Mock: Expense tracker -->
          <div
            class="transition-all duration-700 delay-200"
            :class="
              visibleSections.has(2) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
            "
          >
            <div
              class="rounded-2xl border border-sand-200/80 bg-white shadow-xl shadow-sand-900/5 overflow-hidden"
            >
              <div class="border-b border-sand-100 bg-sand-50 px-5 py-3">
                <h4 class="text-sm font-semibold text-sand-900">Trip Budget</h4>
              </div>
              <div class="p-5 sm:p-6 space-y-5">
                <!-- Budget summary -->
                <div class="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p class="font-display text-2xl text-sand-900">$2,000</p>
                    <p class="text-[11px] text-sand-500">Budget</p>
                  </div>
                  <div>
                    <p class="font-display text-2xl text-terra-600">$1,240</p>
                    <p class="text-[11px] text-sand-500">Estimated</p>
                  </div>
                  <div>
                    <p class="font-display text-2xl text-forest-600">$680</p>
                    <p class="text-[11px] text-sand-500">Spent</p>
                  </div>
                </div>

                <!-- Progress bar -->
                <div>
                  <div class="flex justify-between text-xs text-sand-500 mb-1.5">
                    <span>Budget used</span>
                    <span class="font-medium text-sand-700">34%</span>
                  </div>
                  <div class="h-2 w-full rounded-full bg-sand-100">
                    <div class="h-2 rounded-full bg-forest-500 transition-all" style="width: 34%" />
                  </div>
                </div>

                <!-- Category breakdown -->
                <div class="space-y-3 border-t border-sand-100 pt-4">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="h-2.5 w-2.5 rounded-full bg-ocean-500" />
                      <span class="text-sm text-sand-700">Accommodation</span>
                    </div>
                    <span class="text-sm font-medium text-sand-900">$320</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="h-2.5 w-2.5 rounded-full bg-terra-500" />
                      <span class="text-sm text-sand-700">Food & Dining</span>
                    </div>
                    <span class="text-sm font-medium text-sand-900">$185</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="h-2.5 w-2.5 rounded-full bg-forest-500" />
                      <span class="text-sm text-sand-700">Activities</span>
                    </div>
                    <span class="text-sm font-medium text-sand-900">$120</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="h-2.5 w-2.5 rounded-full bg-sand-400" />
                      <span class="text-sm text-sand-700">Transport</span>
                    </div>
                    <span class="text-sm font-medium text-sand-900">$55</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature 4: Explore / Scratch Map -->
    <section data-section="3" class="relative overflow-hidden bg-sand-100/50 py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-6">
        <div class="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <!-- Mock: Scratch map preview -->
          <div
            class="order-2 lg:order-1 transition-all duration-700 delay-200"
            :class="
              visibleSections.has(3) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
            "
          >
            <div
              class="rounded-2xl border border-sand-200/80 bg-white shadow-xl shadow-sand-900/5 overflow-hidden"
            >
              <div class="border-b border-sand-100 bg-sand-50 px-5 py-3 flex items-center gap-2">
                <Icon name="lucide:globe" class="h-4 w-4 text-terra-500" />
                <h4 class="text-sm font-semibold text-sand-900">My Travel Map</h4>
                <span class="ml-auto text-xs text-sand-400">12 countries visited</span>
              </div>
              <div class="p-5 sm:p-6">
                <!-- Stylized world map representation -->
                <div class="relative">
                  <!-- SVG simplified world map outline -->
                  <svg
                    viewBox="0 0 800 400"
                    class="w-full h-auto"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <!-- Background grid lines -->
                    <defs>
                      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path
                          d="M 40 0 L 0 0 0 40"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="0.5"
                          class="text-sand-200"
                        />
                      </pattern>
                    </defs>
                    <rect width="800" height="400" fill="url(#grid)" rx="12" />

                    <!-- Simplified continent blobs -->
                    <!-- North America -->
                    <path
                      d="M120,80 Q160,60 200,75 Q240,50 260,80 Q280,60 300,85 Q290,120 270,150 Q240,170 210,180 Q180,200 150,190 Q130,170 120,140 Z"
                      class="fill-sand-200/60"
                    />
                    <!-- South America -->
                    <path
                      d="M210,210 Q230,200 250,215 Q260,240 265,270 Q260,310 245,340 Q230,360 220,350 Q200,320 195,280 Q195,250 210,210 Z"
                      class="fill-sand-200/60"
                    />
                    <!-- Europe -->
                    <path
                      d="M380,70 Q410,55 440,65 Q460,60 470,80 Q460,100 450,110 Q430,120 410,115 Q390,110 380,95 Z"
                      class="fill-sand-200/60"
                    />
                    <!-- Africa -->
                    <path
                      d="M400,140 Q430,130 450,145 Q465,170 470,210 Q465,260 450,290 Q430,310 415,300 Q395,280 390,240 Q385,200 390,170 Z"
                      class="fill-sand-200/60"
                    />
                    <!-- Asia -->
                    <path
                      d="M490,60 Q540,40 590,55 Q640,50 680,70 Q700,90 690,120 Q670,150 640,160 Q600,170 560,165 Q520,155 500,130 Q480,100 490,60 Z"
                      class="fill-sand-200/60"
                    />
                    <!-- Australia -->
                    <path
                      d="M630,260 Q670,250 700,265 Q720,280 715,305 Q700,320 670,315 Q640,310 630,290 Z"
                      class="fill-sand-200/60"
                    />

                    <!-- Visited countries highlighted (Japan) -->
                    <circle
                      cx="680"
                      cy="100"
                      r="12"
                      class="fill-terra-500/20 stroke-terra-500 stroke-1"
                    />
                    <circle cx="680" cy="100" r="4" class="fill-terra-500" />

                    <!-- Visited: France -->
                    <circle
                      cx="420"
                      cy="85"
                      r="10"
                      class="fill-terra-500/20 stroke-terra-500 stroke-1"
                    />
                    <circle cx="420" cy="85" r="4" class="fill-terra-500" />

                    <!-- Visited: Thailand -->
                    <circle
                      cx="610"
                      cy="140"
                      r="10"
                      class="fill-terra-500/20 stroke-terra-500 stroke-1"
                    />
                    <circle cx="610" cy="140" r="4" class="fill-terra-500" />

                    <!-- Visited: USA -->
                    <circle
                      cx="200"
                      cy="110"
                      r="12"
                      class="fill-terra-500/20 stroke-terra-500 stroke-1"
                    />
                    <circle cx="200" cy="110" r="4" class="fill-terra-500" />

                    <!-- Visited: Italy -->
                    <circle
                      cx="440"
                      cy="95"
                      r="8"
                      class="fill-terra-500/20 stroke-terra-500 stroke-1"
                    />
                    <circle cx="440" cy="95" r="3" class="fill-terra-500" />

                    <!-- Visited: Australia -->
                    <circle
                      cx="680"
                      cy="285"
                      r="10"
                      class="fill-terra-500/20 stroke-terra-500 stroke-1"
                    />
                    <circle cx="680" cy="285" r="4" class="fill-terra-500" />

                    <!-- Connecting dotted lines -->
                    <line
                      x1="200"
                      y1="110"
                      x2="420"
                      y2="85"
                      stroke-dasharray="4,4"
                      class="stroke-terra-300"
                      stroke-width="1"
                    />
                    <line
                      x1="420"
                      y1="85"
                      x2="680"
                      y2="100"
                      stroke-dasharray="4,4"
                      class="stroke-terra-300"
                      stroke-width="1"
                    />
                  </svg>
                </div>

                <!-- Country list -->
                <div class="mt-4 flex flex-wrap gap-1.5">
                  <span
                    class="rounded-full bg-terra-50 px-2.5 py-1 text-[10px] font-medium text-terra-700"
                    >Japan</span
                  >
                  <span
                    class="rounded-full bg-terra-50 px-2.5 py-1 text-[10px] font-medium text-terra-700"
                    >France</span
                  >
                  <span
                    class="rounded-full bg-terra-50 px-2.5 py-1 text-[10px] font-medium text-terra-700"
                    >Thailand</span
                  >
                  <span
                    class="rounded-full bg-terra-50 px-2.5 py-1 text-[10px] font-medium text-terra-700"
                    >USA</span
                  >
                  <span
                    class="rounded-full bg-terra-50 px-2.5 py-1 text-[10px] font-medium text-terra-700"
                    >Italy</span
                  >
                  <span
                    class="rounded-full bg-terra-50 px-2.5 py-1 text-[10px] font-medium text-terra-700"
                    >Australia</span
                  >
                  <span
                    class="rounded-full bg-sand-100 px-2.5 py-1 text-[10px] font-medium text-sand-500"
                    >+6 more</span
                  >
                </div>
              </div>
            </div>
          </div>

          <!-- Text -->
          <div
            class="order-1 lg:order-2 transition-all duration-700"
            :class="
              visibleSections.has(3) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            "
          >
            <div
              class="inline-flex items-center gap-2 rounded-full bg-terra-50 px-3 py-1 text-xs font-medium text-terra-700"
            >
              <Icon name="lucide:globe" class="h-3.5 w-3.5" />
              Travel Map
            </div>
            <h2 class="mt-4 font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
              Track everywhere
              <span class="text-gradient">you've been.</span>
            </h2>
            <p class="mt-4 max-w-md text-base leading-relaxed text-sand-600">
              Your personal scratch map lights up as you travel. See every country you've visited on
              an interactive world map and track your journey across the globe.
            </p>
            <ul class="mt-6 space-y-3">
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Interactive world map with click-to-mark countries
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Auto-tracks countries from your planned trips
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Share your travel stats with friends
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature 5: Collaborative Planning -->
    <section data-section="4" class="relative overflow-hidden py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-6">
        <div class="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <!-- Text -->
          <div
            class="transition-all duration-700"
            :class="
              visibleSections.has(4) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            "
          >
            <div
              class="inline-flex items-center gap-2 rounded-full bg-ocean-50 px-3 py-1 text-xs font-medium text-ocean-700"
            >
              <Icon name="lucide:users" class="h-3.5 w-3.5" />
              Collaborative
            </div>
            <h2 class="mt-4 font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
              Plan together.
              <span class="text-gradient">Travel together.</span>
            </h2>
            <p class="mt-4 max-w-md text-base leading-relaxed text-sand-600">
              Invite friends and family to your trip. Vote on activities, leave comments, and build
              the perfect group itinerary without endless group chats.
            </p>
            <ul class="mt-6 space-y-3">
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Invite collaborators via shareable link
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Vote on activities to prioritize group favorites
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Comment threads on every activity
              </li>
            </ul>
          </div>

          <!-- Mock: Collaborative activity -->
          <div
            class="transition-all duration-700 delay-200"
            :class="
              visibleSections.has(4) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
            "
          >
            <div class="space-y-3">
              <div
                class="rounded-2xl border border-sand-200/80 bg-white p-5 shadow-lg shadow-sand-900/5"
              >
                <div class="flex items-start gap-3">
                  <span
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white"
                    >1</span
                  >
                  <div class="flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h5 class="font-semibold text-sand-900">Arashiyama Bamboo Grove</h5>
                      <span
                        class="rounded-full bg-ocean-50 px-2.5 py-0.5 text-[10px] font-medium text-ocean-700"
                        >Attraction</span
                      >
                    </div>
                    <p class="mt-1 text-sm text-sand-500">
                      Walk through towering bamboo stalks in one of Kyoto's most photogenic spots.
                    </p>

                    <!-- Participants -->
                    <div class="mt-3 flex items-center gap-2">
                      <div class="flex -space-x-1.5">
                        <span
                          class="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-terra-500 text-[9px] font-bold text-white"
                          >JT</span
                        >
                        <span
                          class="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-ocean-500 text-[9px] font-bold text-white"
                          >AK</span
                        >
                        <span
                          class="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-forest-500 text-[9px] font-bold text-white"
                          >ML</span
                        >
                      </div>
                      <span class="text-xs text-sand-400">3 going</span>
                    </div>

                    <!-- Vote + comment bar -->
                    <div class="mt-3 flex items-center gap-4 border-t border-sand-100 pt-3">
                      <div class="flex items-center gap-1.5 text-xs text-forest-600 font-medium">
                        <Icon name="lucide:thumbs-up" class="h-3.5 w-3.5" />
                        <span>5</span>
                      </div>
                      <div class="flex items-center gap-1.5 text-xs text-sand-400">
                        <Icon name="lucide:thumbs-down" class="h-3.5 w-3.5" />
                      </div>
                      <div
                        class="ml-auto flex items-center gap-1.5 text-xs text-ocean-600 font-medium"
                      >
                        <Icon name="lucide:message-circle" class="h-3.5 w-3.5" />
                        <span>3 comments</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Mock comment thread -->
              <div class="ml-6 rounded-xl border border-sand-200/60 bg-sand-50 p-4 space-y-3">
                <div class="flex items-start gap-2.5">
                  <span
                    class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ocean-500 text-[8px] font-bold text-white mt-0.5"
                    >AK</span
                  >
                  <div>
                    <p class="text-xs font-medium text-sand-700">
                      Amy K.
                      <span class="font-normal text-sand-400 ml-1">2h ago</span>
                    </p>
                    <p class="mt-0.5 text-xs text-sand-600">
                      Go early morning before 8am, way less crowded!
                    </p>
                  </div>
                </div>
                <div class="flex items-start gap-2.5">
                  <span
                    class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-500 text-[8px] font-bold text-white mt-0.5"
                    >ML</span
                  >
                  <div>
                    <p class="text-xs font-medium text-sand-700">
                      Mike L.
                      <span class="font-normal text-sand-400 ml-1">1h ago</span>
                    </p>
                    <p class="mt-0.5 text-xs text-sand-600">
                      Can we combine this with the monkey park nearby? It's a short walk.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature 6: Flight Tracking & Visa -->
    <section data-section="5" class="relative overflow-hidden bg-sand-100/50 py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-6">
        <div class="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <!-- Mock: Flight card + visa badge -->
          <div
            class="order-2 lg:order-1 transition-all duration-700 delay-200"
            :class="
              visibleSections.has(5) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
            "
          >
            <div class="space-y-3">
              <!-- Mock flight card -->
              <div
                class="rounded-2xl border border-sand-200/80 bg-white p-5 shadow-lg shadow-sand-900/5"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sand-100"
                  >
                    <Icon name="lucide:plane" class="h-5 w-5 text-sand-500" />
                  </div>
                  <div>
                    <p class="text-xs text-sand-500">Singapore Airlines</p>
                    <p class="font-display text-lg text-sand-900">SQ638</p>
                  </div>
                  <span
                    class="ml-auto rounded-full bg-forest-50 px-2.5 py-0.5 text-xs font-medium text-forest-700"
                    >On Time</span
                  >
                </div>
                <div class="mt-4 flex items-center gap-3">
                  <div class="text-center">
                    <p class="font-display text-xl text-sand-900">SIN</p>
                    <p class="text-xs text-sand-500">08:15</p>
                  </div>
                  <div class="flex flex-1 items-center">
                    <div class="h-px flex-1 bg-sand-200" />
                    <Icon name="lucide:plane" class="mx-2 h-4 w-4 text-sand-400" />
                    <div class="h-px flex-1 bg-sand-200" />
                  </div>
                  <div class="text-center">
                    <p class="font-display text-xl text-sand-900">NRT</p>
                    <p class="text-xs text-sand-500">16:30</p>
                  </div>
                </div>
                <div class="mt-3 flex items-center gap-2 text-xs text-sand-500">
                  <span>Wed, Apr 15</span>
                  <span>&#183; Terminal 3</span>
                  <span>&#183; Gate C22</span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700"
                  >
                    <Icon name="lucide:check-circle" class="h-2.5 w-2.5" />
                    Visa Free (30d)
                  </span>
                </div>
              </div>

              <!-- Mock passport card -->
              <div
                class="rounded-2xl border border-sand-200/80 bg-white p-5 shadow-lg shadow-sand-900/5"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <Icon name="lucide:book-open" class="h-5 w-5 text-terra-500" />
                    <div>
                      <p class="text-sm font-medium text-sand-900">Malaysia</p>
                      <p class="text-xs text-sand-500">MY &#183; Exp Jul 2027</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-1">
                    <span class="font-mono text-xs text-sand-500"
                      >&#8226;&#8226;&#8226;&#8226;8695</span
                    >
                    <Icon name="lucide:eye" class="h-3 w-3 text-sand-400" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Text -->
          <div
            class="order-1 lg:order-2 transition-all duration-700"
            :class="
              visibleSections.has(5) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            "
          >
            <div
              class="inline-flex items-center gap-2 rounded-full bg-ocean-50 px-3 py-1 text-xs font-medium text-ocean-700"
            >
              <Icon name="lucide:plane" class="h-3.5 w-3.5" />
              Flight Tracking
            </div>
            <h2 class="mt-4 font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
              Track flights.
              <span class="text-gradient">Check visas instantly.</span>
            </h2>
            <p class="mt-4 max-w-md text-base leading-relaxed text-sand-600">
              Add your flight numbers to see live gate info, terminal details, and delay updates.
              Visa requirements are checked automatically based on your passport.
            </p>
            <ul class="mt-6 space-y-3">
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Live flight status with gate and terminal info
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Automatic visa checks for 199 countries
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Encrypted passport storage with expiry alerts
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════ FINAL CTA ═══════ -->
    <section class="relative overflow-hidden py-24 sm:py-32">
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-terra-200/20 blur-[120px]"
        />
      </div>
      <div class="relative z-10 mx-auto max-w-2xl px-6 text-center">
        <h2 class="font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
          Ready to plan your next
          <span class="text-gradient">adventure?</span>
        </h2>
        <p class="mx-auto mt-4 max-w-md text-base leading-relaxed text-sand-600">
          Join travelers who plan smarter with AI-powered itineraries and real, verified places.
        </p>
        <NuxtLink
          to="/login"
          class="mt-8 inline-flex items-center gap-2 rounded-xl bg-terra-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-terra-500/25 transition-all hover:bg-terra-600 hover:shadow-xl hover:shadow-terra-500/30"
        >
          <Icon name="lucide:sparkles" class="h-4 w-4" />
          {{ "Get started free" }}
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Stagger feature section children for cascade reveal */
.feature-mock-enter {
  opacity: 0;
  transform: translateY(20px);
}
</style>
