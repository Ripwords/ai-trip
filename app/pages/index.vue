<script setup lang="ts">
import { authClient } from "../lib/auth-client"

useSeoMeta({
  title: "Plan Your Trip with AI",
  description:
    "AI finds hidden gems, checks trip essentials before you fly, and keeps every itinerary editable.",
  ogTitle: "AI Trip: Plan Your Trip with AI",
  ogDescription:
    "AI-powered travel planner with verified places, editable itineraries, and calm pre-trip briefings before you fly.",
})

useSchemaOrg([
  defineWebSite({
    name: "AI Trip",
    description: "AI-powered travel itinerary planner with real places verified by Google Maps",
  }),
  defineWebPage({
    "@type": "WebPage",
    name: "AI Trip: Plan Your Trip with AI",
    description:
      "AI-powered travel planner with verified places, editable itineraries, and calm pre-trip briefings before you fly.",
  }),
])

// Intersection observer for scroll-triggered animations
const visibleSections = reactive(new Set<number>())

const reduceMotion = useReducedMotion()
// When reduced motion is preferred, render the final visible state directly
// and skip the hidden/translated initial state used for the reveal.
function revealed(idx: number) {
  return reduceMotion.value || visibleSections.has(idx)
}

const signInPending = ref(false)

function signInWithGoogle() {
  signInPending.value = true
  authClient.signIn.social({
    provider: "google",
    callbackURL: "/dashboard",
    errorCallbackURL: "/",
  })
}

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
    <!-- ═══════ HERO (centered editorial) ═══════ -->
    <section class="relative flex min-h-[100dvh] flex-col overflow-hidden">
      <!-- Single ambient element -->
      <div
        class="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-terra-200/25 blur-[130px]"
        aria-hidden="true"
      />

      <div
        class="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pt-24 pb-10 text-center"
      >
        <p class="text-xs font-medium uppercase tracking-[0.2em] text-terra-600">
          AI travel planning
        </p>

        <h1
          class="mt-6 font-display text-5xl leading-[1.05] tracking-tight text-sand-900 sm:text-7xl lg:text-8xl"
        >
          Plan trips that<br />
          <span class="text-gradient">feel local</span>
        </h1>

        <p class="mx-auto mt-6 max-w-md text-base leading-relaxed text-sand-600 sm:text-lg">
          AI finds the places locals love, then checks your flight and documents before you fly.
        </p>

        <div class="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <button
            type="button"
            :disabled="signInPending"
            aria-label="Sign in with Google to start planning"
            class="focus-ring group relative flex items-center gap-2.5 overflow-hidden rounded-xl bg-terra-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-terra-500/25 transition-all hover:bg-terra-600 hover:shadow-xl hover:shadow-terra-500/30 disabled:cursor-not-allowed disabled:opacity-70"
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
            <span class="relative z-10">{{
              signInPending ? "Redirecting..." : "Sign in with Google"
            }}</span>
          </button>

          <a
            href="#how-it-works"
            class="focus-ring inline-flex items-center gap-1.5 rounded-xl px-5 py-3.5 text-sm font-semibold text-sand-700 transition-colors hover:text-terra-600"
          >
            See how it works
            <Icon name="lucide:arrow-down" class="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>

      <!-- ONE tasteful hero visual, sits just below the fold -->
      <!-- TODO: real screenshot of the trip itinerary detail view (~3:4 portrait) to replace this card -->
      <div class="relative z-10 mx-auto w-full max-w-sm px-6 pb-14">
        <figure
          class="rounded-2xl border border-sand-200/80 bg-white p-5 shadow-2xl shadow-sand-900/10"
        >
          <figcaption class="flex items-center justify-between">
            <span class="font-display text-lg text-sand-900">Day 2 in Kyoto</span>
            <span
              class="rounded-full bg-sand-100 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sand-500"
            >
              Illustrative
            </span>
          </figcaption>
          <ol class="mt-4 space-y-2">
            <li class="flex items-center gap-3 rounded-xl border border-sand-100 bg-sand-50/60 p-3">
              <span class="font-mono text-[11px] text-terra-600">9:00</span>
              <span class="flex-1 text-sm font-medium text-sand-800">Fushimi Inari Taisha</span>
              <Icon name="lucide:mountain" class="h-4 w-4 text-ocean-500" aria-hidden="true" />
            </li>
            <li class="flex items-center gap-3 rounded-xl border border-sand-100 bg-sand-50/60 p-3">
              <span class="font-mono text-[11px] text-terra-600">12:30</span>
              <span class="flex-1 text-sm font-medium text-sand-800">Nishiki Market</span>
              <Icon name="lucide:utensils" class="h-4 w-4 text-terra-500" aria-hidden="true" />
            </li>
            <li class="flex items-center gap-3 rounded-xl border border-sand-100 bg-sand-50/60 p-3">
              <span class="font-mono text-[11px] text-terra-600">15:00</span>
              <span class="flex-1 text-sm font-medium text-sand-800">Kiyomizu-dera</span>
              <Icon name="lucide:mountain" class="h-4 w-4 text-ocean-500" aria-hidden="true" />
            </li>
          </ol>
        </figure>
      </div>
    </section>

    <!-- ═══════ FEATURE SECTIONS ═══════ -->

    <!-- Feature 1: AI Itinerary Generation (zigzag #1: text left / editorial visual right) -->
    <section id="how-it-works" data-section="0" class="relative overflow-hidden py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-6">
        <div class="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div
            class="transition-all duration-700"
            :class="revealed(0) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'"
          >
            <h2 class="font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
              AI drafts your whole itinerary
            </h2>
            <p class="mt-4 max-w-md text-base leading-relaxed text-sand-600">
              Say where, when, and how much you want to spend. You get a day-by-day plan with real
              places, timing, and costs, all still editable.
            </p>
            <ul class="mt-6 space-y-3">
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Structured day-by-day plans with timing
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
                Add, remove, or rearrange anything you like
              </li>
            </ul>
          </div>

          <!-- Editorial input/output panel -->
          <div
            class="transition-all duration-700 delay-200"
            :class="revealed(0) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'"
          >
            <div
              class="rounded-2xl border border-sand-200/80 bg-white p-6 shadow-xl shadow-sand-900/5 sm:p-8"
            >
              <p class="text-xs font-medium uppercase tracking-[0.18em] text-sand-400">
                You describe
              </p>
              <p class="mt-3 font-display text-xl leading-snug text-sand-900 sm:text-2xl">
                "Six days in Kyoto in May, cultural and food focused, around $2,000."
              </p>

              <div class="my-6 h-px bg-sand-100" />

              <p class="text-xs font-medium uppercase tracking-[0.18em] text-terra-500">
                AI returns
              </p>
              <ul class="mt-3 space-y-2.5">
                <li class="flex items-center gap-3 text-sm text-sand-700">
                  <Icon name="lucide:map-pin" class="h-4 w-4 shrink-0 text-terra-500" />
                  Fushimi Inari Taisha
                  <span class="ml-auto font-mono text-xs text-sand-400">Day 2, 9:00</span>
                </li>
                <li class="flex items-center gap-3 text-sm text-sand-700">
                  <Icon name="lucide:map-pin" class="h-4 w-4 shrink-0 text-terra-500" />
                  Nishiki Market
                  <span class="ml-auto font-mono text-xs text-sand-400">Day 2, 12:30</span>
                </li>
                <li class="flex items-center gap-3 text-sm text-sand-700">
                  <Icon name="lucide:map-pin" class="h-4 w-4 shrink-0 text-terra-500" />
                  Kiyomizu-dera
                  <span class="ml-auto font-mono text-xs text-sand-400">Day 2, 15:00</span>
                </li>
              </ul>
              <p class="mt-5 text-xs text-sand-400">
                Illustrative preview. Every place is verified before it lands in your plan.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature 2: Google Maps Verified (full-bleed centered feature) -->
    <section data-section="1" class="relative overflow-hidden bg-sand-100/50 py-24 sm:py-32">
      <div
        class="mx-auto max-w-3xl px-6 text-center transition-all duration-700"
        :class="revealed(1) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'"
      >
        <h2 class="font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
          We never invent places
        </h2>
        <p class="mx-auto mt-4 max-w-xl text-base leading-relaxed text-sand-600">
          Chatbots hallucinate restaurants that were never real. Here, every location is resolved
          through Google Maps, with the actual rating, address, and hours attached.
        </p>

        <!-- Single verified place card, centered -->
        <div
          class="mx-auto mt-10 max-w-md rounded-2xl border border-sand-200/80 bg-white p-5 text-left shadow-lg shadow-sand-900/5"
        >
          <div class="flex items-start gap-3">
            <span
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white"
              >1</span
            >
            <div class="flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-semibold text-sand-900">Fushimi Inari Taisha</h3>
                <span
                  class="rounded-full bg-ocean-50 px-2.5 py-0.5 text-[10px] font-medium text-ocean-700"
                  >Attraction</span
                >
              </div>
              <p class="mt-1 text-sm text-sand-500">
                Thousands of vermillion torii gates winding through the forested mountain.
              </p>
              <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-sand-500">
                <span class="flex items-center gap-1 text-ocean-600">
                  <Icon name="lucide:map-pin" class="h-3 w-3" />
                  68 Fukakusa, Fushimi-ku
                </span>
                <span class="flex items-center gap-1">
                  <Icon name="mdi:star" class="h-3 w-3 text-terra-400" />
                  Highly rated
                </span>
                <span>Free entry</span>
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

        <!-- Three inline trust points -->
        <div class="mx-auto mt-10 grid max-w-2xl gap-6 text-left sm:grid-cols-3">
          <div>
            <Icon name="lucide:star" class="h-5 w-5 text-terra-500" aria-hidden="true" />
            <p class="mt-2 text-sm font-semibold text-sand-900">Real ratings</p>
            <p class="mt-1 text-xs leading-5 text-sand-500">
              Pulled straight from Google, not guessed.
            </p>
          </div>
          <div>
            <Icon name="lucide:clock" class="h-5 w-5 text-terra-500" aria-hidden="true" />
            <p class="mt-2 text-sm font-semibold text-sand-900">Accurate hours</p>
            <p class="mt-1 text-xs leading-5 text-sand-500">
              Addresses and opening times you can trust.
            </p>
          </div>
          <div>
            <Icon name="lucide:navigation" class="h-5 w-5 text-terra-500" aria-hidden="true" />
            <p class="mt-2 text-sm font-semibold text-sand-900">One-tap directions</p>
            <p class="mt-1 text-xs leading-5 text-sand-500">
              Open any stop in Google Maps instantly.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature 3: Pre-trip Briefing (zigzag #2: editorial surface left / text right) -->
    <section data-section="2" class="relative overflow-hidden py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-6">
        <div class="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <!-- Briefing surface -->
          <div
            class="order-2 lg:order-1 transition-all duration-700 delay-200"
            :class="revealed(2) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'"
          >
            <div
              class="rounded-[1.75rem] border border-sand-200/70 bg-sand-50/80 p-3 shadow-2xl shadow-sand-900/8 backdrop-blur sm:p-4"
            >
              <div class="grid gap-3 lg:grid-cols-[minmax(0,1.32fr)_minmax(210px,0.68fr)]">
                <div
                  class="landing-briefing-hero-surface relative min-h-[250px] overflow-hidden rounded-2xl p-5 sm:p-6"
                >
                  <div
                    class="landing-briefing-orbit absolute -bottom-16 -right-12 h-48 w-48 rounded-full"
                  />
                  <div class="relative z-10 flex h-full flex-col">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p class="text-[11px] font-semibold text-terra-500">Sample briefing</p>
                        <h3
                          class="mt-2 font-display text-3xl leading-none text-sand-900 sm:text-4xl"
                        >
                          Barcelona <span class="text-terra-500">in 3 days</span>
                        </h3>
                        <p class="mt-2 flex flex-wrap items-center gap-x-1 text-sm text-sand-600">
                          Fly Mon, Sep 14
                          <span class="mx-1 text-sand-300">·</span>
                          Trip Tue, Sep 15 to Sun, Sep 20
                        </p>
                      </div>
                      <div
                        class="rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-sand-700 shadow-sm backdrop-blur dark:bg-white/10 dark:text-sand-800"
                      >
                        Depart Sep 14
                      </div>
                    </div>

                    <p class="mt-5 max-w-2xl text-sm leading-6 text-sand-700 sm:text-[15px]">
                      Flight AX214 departs LHR at 8:40 PM. Departure, document, and stay details are
                      ready.
                    </p>

                    <div class="mt-auto flex flex-wrap gap-2 pt-8">
                      <span
                        class="inline-flex items-center rounded-full border border-sand-200 bg-white/75 px-3 py-1.5 text-xs font-semibold text-sand-700 backdrop-blur dark:bg-white/10 dark:text-sand-800"
                      >
                        LHR to LIS
                      </span>
                      <span
                        class="inline-flex items-center rounded-full border border-sand-200 bg-white/75 px-3 py-1.5 text-xs font-semibold text-sand-700 backdrop-blur dark:bg-white/10 dark:text-sand-800"
                      >
                        Terminal 2
                      </span>
                      <span
                        class="inline-flex items-center rounded-full border border-forest-100 bg-forest-50 px-3 py-1.5 text-xs font-semibold text-forest-700 backdrop-blur"
                      >
                        Stay saved
                      </span>
                      <span
                        class="inline-flex items-center rounded-full border border-terra-100 bg-terra-50 px-3 py-1.5 text-xs font-semibold text-terra-600 backdrop-blur"
                      >
                        Layover: Lisbon
                      </span>
                    </div>
                  </div>
                </div>

                <div class="grid gap-3">
                  <div class="flex min-h-[76px] items-start gap-3 rounded-2xl bg-forest-50 p-4">
                    <span
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-forest-100 text-forest-700"
                    >
                      <Icon name="lucide:shield-check" class="h-4 w-4" />
                    </span>
                    <span class="min-w-0">
                      <span class="block text-sm font-semibold text-sand-900">Visa clear</span>
                      <span class="mt-1 block text-xs leading-5 text-sand-600">
                        Passport profile checked for Spain and Portugal.
                      </span>
                    </span>
                  </div>

                  <div class="flex min-h-[76px] items-start gap-3 rounded-2xl bg-forest-50 p-4">
                    <span
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-forest-100 text-forest-700"
                    >
                      <Icon name="lucide:book-open" class="h-4 w-4" />
                    </span>
                    <span class="min-w-0">
                      <span class="block text-sm font-semibold text-sand-900">Passport ready</span>
                      <span class="mt-1 block text-xs leading-5 text-sand-600">
                        Validity remains comfortably beyond the itinerary.
                      </span>
                    </span>
                  </div>

                  <div class="flex min-h-[76px] items-start gap-3 rounded-2xl bg-ocean-50 p-4">
                    <span
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ocean-100 text-ocean-700"
                    >
                      <Icon name="lucide:plane" class="h-4 w-4" />
                    </span>
                    <span class="min-w-0">
                      <span class="block text-sm font-semibold text-sand-900">Flight saved</span>
                      <span class="mt-1 block text-xs leading-5 text-sand-600">
                        AX214 LHR to LIS at 8:40 PM.
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Text -->
          <div
            class="order-1 lg:order-2 transition-all duration-700"
            :class="revealed(2) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'"
          >
            <h2 class="font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
              Know what needs attention before you fly
            </h2>
            <p class="mt-4 max-w-md text-base leading-relaxed text-sand-600">
              Within seven days of departure, your dashboard surfaces a concise briefing with the
              essentials: flight timing, passport validity, visa status, accommodation, and layover
              context.
            </p>
            <ul class="mt-6 space-y-3">
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Flags when your outbound flight leaves before the trip start date
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Includes visa context for the destination and eligible layovers
              </li>
              <li class="flex items-start gap-3 text-sm text-sand-700">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-100 text-forest-600"
                >
                  <Icon name="lucide:check" class="h-3 w-3" />
                </span>
                Keeps readiness checks visible without crowding the dashboard
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature 4: Budget, map, and group planning (asymmetric bento grid) -->
    <section data-section="3" class="relative overflow-hidden bg-sand-100/50 py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-6">
        <div
          class="max-w-2xl transition-all duration-700"
          :class="revealed(3) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'"
        >
          <h2 class="font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
            Everything else the trip needs
          </h2>
          <p class="mt-4 text-base leading-relaxed text-sand-600">
            Track spending, watch your map fill in, and plan with the people coming along.
          </p>
        </div>

        <div
          class="mt-12 grid gap-4 transition-all duration-700 delay-150 md:grid-cols-3"
          :class="revealed(3) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'"
        >
          <!-- Budget (wide) -->
          <div
            class="rounded-2xl border border-sand-200/80 bg-white p-6 shadow-lg shadow-sand-900/5 md:col-span-2"
          >
            <div class="flex items-center justify-between">
              <h3 class="font-display text-xl text-sand-900">Stay on budget</h3>
              <span
                class="rounded-full bg-sand-100 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sand-500"
                >Sample trip</span
              >
            </div>
            <p class="mt-2 text-sm text-sand-600">
              Roughly $1,200 planned against a $2,000 budget, about a third used so far.
            </p>
            <div class="mt-5">
              <div class="mb-1.5 flex justify-between text-xs text-sand-500">
                <span>Budget used</span>
                <span class="font-medium text-sand-700">About a third</span>
              </div>
              <div class="h-2 w-full rounded-full bg-sand-100">
                <div class="h-2 rounded-full bg-forest-500" style="width: 34%" />
              </div>
            </div>
            <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-ocean-500" />
                <span class="text-xs text-sand-600">Stays</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-terra-500" />
                <span class="text-xs text-sand-600">Food</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-forest-500" />
                <span class="text-xs text-sand-600">Activities</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-sand-400" />
                <span class="text-xs text-sand-600">Transport</span>
              </div>
            </div>
          </div>

          <!-- Travel map (typographic, no fake SVG map) -->
          <div
            class="flex flex-col rounded-2xl border border-terra-100 bg-gradient-to-br from-terra-50 to-sand-50 p-6 shadow-lg shadow-sand-900/5"
          >
            <div class="flex items-center gap-2">
              <Icon name="lucide:globe" class="h-4 w-4 text-terra-500" aria-hidden="true" />
              <h3 class="font-display text-xl text-sand-900">Your map fills in</h3>
            </div>
            <p class="mt-2 text-sm text-sand-600">
              Every country lights up as you travel. A dozen or so on this example map.
            </p>
            <div class="mt-4 flex flex-wrap gap-1.5">
              <span
                class="rounded-full bg-terra-100 px-2.5 py-1 text-[10px] font-medium text-terra-700"
                >Japan</span
              >
              <span
                class="rounded-full bg-terra-100 px-2.5 py-1 text-[10px] font-medium text-terra-700"
                >France</span
              >
              <span
                class="rounded-full bg-terra-100 px-2.5 py-1 text-[10px] font-medium text-terra-700"
                >Thailand</span
              >
              <span
                class="rounded-full bg-terra-100 px-2.5 py-1 text-[10px] font-medium text-terra-700"
                >Portugal</span
              >
              <span
                class="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-medium text-sand-500"
                >and more</span
              >
            </div>
          </div>

          <!-- Collaborative (wide) -->
          <div
            class="rounded-2xl border border-sand-200/80 bg-white p-6 shadow-lg shadow-sand-900/5 md:col-span-3"
          >
            <div class="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div class="max-w-md">
                <div class="flex items-center gap-2">
                  <Icon name="lucide:users" class="h-4 w-4 text-ocean-500" aria-hidden="true" />
                  <h3 class="font-display text-xl text-sand-900">Plan it as a group</h3>
                </div>
                <p class="mt-2 text-sm text-sand-600">
                  Invite the people coming along, vote on activities, and settle plans in one place
                  instead of a scattered group chat.
                </p>
                <div class="mt-4 flex items-center gap-2">
                  <div class="flex -space-x-1.5">
                    <span
                      class="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-terra-500 text-[9px] font-bold text-white"
                      >PN</span
                    >
                    <span
                      class="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-ocean-500 text-[9px] font-bold text-white"
                      >ML</span
                    >
                    <span
                      class="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-forest-500 text-[9px] font-bold text-white"
                      >JW</span
                    >
                  </div>
                  <span class="text-xs text-sand-500">3 going</span>
                </div>
              </div>

              <!-- Sample comment thread -->
              <div class="space-y-3 rounded-xl border border-sand-200/60 bg-sand-50 p-4 sm:w-80">
                <div class="flex items-start gap-2.5">
                  <span
                    class="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ocean-500 text-[8px] font-bold text-white"
                    >PN</span
                  >
                  <div>
                    <p class="text-xs font-medium text-sand-700">
                      Priya Nair
                      <span class="ml-1 font-normal text-sand-500">2h ago</span>
                    </p>
                    <p class="mt-0.5 text-xs text-sand-600">
                      Go early morning before 8am, way less crowded.
                    </p>
                  </div>
                </div>
                <div class="flex items-start gap-2.5">
                  <span
                    class="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest-500 text-[8px] font-bold text-white"
                    >ML</span
                  >
                  <div>
                    <p class="text-xs font-medium text-sand-700">
                      Marcus Lindqvist
                      <span class="ml-1 font-normal text-sand-500">1h ago</span>
                    </p>
                    <p class="mt-0.5 text-xs text-sand-600">
                      Can we pair this with the monkey park nearby? Short walk.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Feature 5: Product truths (stat / number band) -->
    <section data-section="4" class="relative overflow-hidden bg-sand-900 py-20 sm:py-24">
      <div
        class="mx-auto max-w-6xl px-6 transition-all duration-700"
        :class="revealed(4) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'"
      >
        <div class="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p class="font-display text-4xl text-sand-50 sm:text-5xl">Zero</p>
            <p class="mt-2 text-sm leading-6 text-sand-300">invented places, ever</p>
          </div>
          <div>
            <p class="font-display text-4xl text-sand-50 sm:text-5xl">195+</p>
            <p class="mt-2 text-sm leading-6 text-sand-300">countries covered via Google Places</p>
          </div>
          <div>
            <p class="font-display text-4xl text-sand-50 sm:text-5xl">One tap</p>
            <p class="mt-2 text-sm leading-6 text-sand-300">to open any stop in Google Maps</p>
          </div>
          <div>
            <p class="font-display text-4xl text-sand-50 sm:text-5xl">7 days</p>
            <p class="mt-2 text-sm leading-6 text-sand-300">before you fly, your briefing lands</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════ FINAL CTA (stacked centered) ═══════ -->
    <section class="relative overflow-hidden py-24 sm:py-32">
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-terra-200/20 blur-[120px]"
        />
      </div>
      <div class="relative z-10 mx-auto max-w-2xl px-6 text-center">
        <h2 class="font-display text-3xl text-sand-900 sm:text-4xl lg:text-5xl">
          Start planning your next trip
        </h2>
        <p class="mx-auto mt-4 max-w-md text-base leading-relaxed text-sand-600">
          Build a day-by-day itinerary with real, verified places, and a calm briefing before you
          leave.
        </p>
        <button
          type="button"
          :disabled="signInPending"
          aria-label="Sign in with Google to start planning"
          class="focus-ring mt-8 inline-flex items-center gap-2.5 rounded-xl bg-terra-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-terra-500/25 transition-all hover:bg-terra-600 hover:shadow-xl hover:shadow-terra-500/30 disabled:cursor-not-allowed disabled:opacity-70"
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
    </section>
  </div>
</template>

<style scoped>
.landing-briefing-hero-surface {
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

.landing-briefing-orbit {
  border: 1px solid color-mix(in srgb, var(--color-sand-500) 24%, transparent);
}

.dark .landing-briefing-hero-surface {
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

.dark .landing-briefing-orbit {
  border-color: color-mix(in srgb, var(--color-sand-500) 20%, transparent);
}
</style>
