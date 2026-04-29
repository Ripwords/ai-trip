# Trip Detail Visual Minimalism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce visual clutter on `app/pages/trips/[id].vue` without removing any feature, by separating information from action, hiding secondary AI controls until intent is signaled, and rationing the terra accent color to primary action surfaces only.

**Architecture:** Six self-contained changes layered onto the existing page. (1) Header: extract a `textClass` from `getTripStatus`, restyle the title block and replace pills with three icon buttons. (2) Day selector: compact numeric tiles. (3) Tabs: underline style with a "More" overflow menu. (4) Preferences: slide-up sheet replacing the inline panel. (5) AI dock: a single floating pill with one "above the dock" reveal zone that holds quick-action chips, suggestion chips, a feedback toast, or nothing — never multiple stacked. (6) Cleanup of deprecated components (`AiQuickActions`, `AiPromptSuggestions`, `AiLoadingOverlay`, `GenerateFullItineraryButton`) once their logic is folded into the dock.

**Tech Stack:** Nuxt 4, Vue 3, Tailwind 4 (sand/terra/forest/ocean palette), `vue-border-beam`, `lucide` icons via `<Icon>`. No test framework configured in this repo — verification is done in the browser at `http://localhost:3000/trips/<id>` against the running dev server (`bun run dev`). Lint/format gate before each commit: `bun run check`.

**Spec:** `docs/superpowers/specs/2026-04-29-trip-detail-visual-minimalism-design.md`

---

## Notes Before You Start

- **Working directory:** project root. All paths are relative to `/Users/jiajingteoh/Documents/ai-trip`.
- **Dev server:** `bun run dev` (Nuxt on `http://localhost:3000`). Keep it running in another terminal — Vue HMR will reflect changes instantly.
- **You will need a real trip to test against.** If your dev DB is empty, create a trip with at least 5 days and a few activities through the UI before starting Task 2. Tasks 1, 3, 4 also benefit from existing data.
- **Status colors used by `getTripStatus` today** (read these from `app/composables/useTripStatus.ts`):
  - `upcoming` → `bg-ocean-50 text-ocean-700`
  - `ongoing` → `bg-forest-50 text-forest-700`
  - `completed` → `bg-sand-200 text-sand-600`
  When the spec says "status text in `text-terra-600`", read that as "use the existing foreground color from `getTripStatus.badgeClass` minus the background" — the actual values to apply are the three above.
- **Conventional Commits, no `--amend`, never `--no-verify`.** The repo runs `oxlint` + `oxfmt` on commit via Husky.
- **The order matters.** Task 4 (Tabs) and Task 5 (Preferences) are independent. Task 6, 7, 8, 9, 10, 11 build the dock incrementally — do them in order. Task 12 wires it into the page. Task 13 deletes the corpses.

---

## File Structure

**Created:**
- `app/components/AiDock.vue` — owns the floating dock, the input, the reveal zone, all four states (idle / focused / loading / feedback).
- `app/components/TripPreferencesSheet.vue` — slide-up sheet replacement for the inline preferences panel.
- `app/composables/useAiPromptSuggestions.ts` — destination-aware suggestion strings used by the dock's reveal zone.
- `app/composables/useGenerateFullItinerary.ts` — extracts the per-day-loop logic from `GenerateFullItineraryButton.vue` so the dock's "Generate full itinerary" chip can call it.

**Modified:**
- `app/composables/useTripStatus.ts` — adds a `textClass` field next to `badgeClass`.
- `app/components/TripDetailTabs.vue` — restructured to underline-tabs + "More" overflow.
- `app/pages/trips/[id].vue` — header, day selector, AI block all rewritten; the inline preferences div removed; `<AiDock>` and `<TripPreferencesSheet>` mounted.

**Deleted:**
- `app/components/AiQuickActions.vue`
- `app/components/AiPromptSuggestions.vue`
- `app/components/AiLoadingOverlay.vue`
- `app/components/GenerateFullItineraryButton.vue`

---

## Task 1: Add `textClass` to `getTripStatus`

**Goal:** Give callers a way to render the status as inline text (no pill background) without redefining the color.

**Files:**
- Modify: `app/composables/useTripStatus.ts`

- [ ] **Step 1: Open the file and read the current shape.**

  The current `TripStatusInfo` has `label`, `status`, `badgeClass`. Confirm before editing.

- [ ] **Step 2: Add `textClass` to the interface and to each branch.**

  Replace the file contents with:

  ```ts
  export type TripStatus = "upcoming" | "ongoing" | "completed"

  export interface TripStatusInfo {
    label: string
    status: TripStatus
    badgeClass: string
    textClass: string
  }

  export function getTripStatus(startDate: string, endDate: string): TripStatusInfo {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const start = new Date(startDate + "T00:00:00")
    const end = new Date(endDate + "T00:00:00")

    if (today < start) {
      return {
        label: "Upcoming",
        status: "upcoming",
        badgeClass: "bg-ocean-50 text-ocean-700",
        textClass: "text-ocean-700",
      }
    }
    if (today > end) {
      return {
        label: "Completed",
        status: "completed",
        badgeClass: "bg-sand-200 text-sand-600",
        textClass: "text-sand-600",
      }
    }
    return {
      label: "Ongoing",
      status: "ongoing",
      badgeClass: "bg-forest-50 text-forest-700",
      textClass: "text-forest-700",
    }
  }
  ```

- [ ] **Step 3: Run lint + format.**

  ```bash
  bun run check
  ```

  Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 4: Verify nothing referencing `getTripStatus` broke.**

  ```bash
  grep -rn "getTripStatus" app/ --include="*.vue" --include="*.ts"
  ```

  Read each call site briefly. Existing `badgeClass` callers are unchanged. The new `textClass` is unused yet — that's fine; Task 2 wires it up.

- [ ] **Step 5: Commit.**

  ```bash
  git add app/composables/useTripStatus.ts
  git commit -m "feat(trip-status): add textClass for inline-text rendering"
  ```

---

## Task 2: Restyle header — title block and icon actions

**Goal:** Replace the back arrow + title + dates row plus the six-pill metadata-and-actions row with a cleaner two-column layout: title block on the left (with one quiet meta line under the destination), three icon-only buttons on the right.

**Files:**
- Modify: `app/pages/trips/[id].vue`

- [ ] **Step 1: Locate the existing header block.**

  Open `app/pages/trips/[id].vue`. Find the comment `<!-- Header -->` (around line 708). The block runs from `<div>` through to the closing `</div>` immediately before `<!-- Preferences editor -->` (around line 876). This is what you're replacing.

- [ ] **Step 2: Replace the header block.**

  Replace the entire `<!-- Header -->` block (everything from `<!-- Header -->` to the closing `</div>` before `<!-- Preferences editor -->`) with:

  ```vue
  <!-- Header -->
  <div class="flex items-start justify-between gap-3">
    <div class="flex min-w-0 flex-1 items-start gap-2">
      <NuxtLink
        to="/dashboard"
        class="mt-1 shrink-0 rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
      >
        <Icon name="lucide:arrow-left" class="h-5 w-5" />
      </NuxtLink>
      <div class="min-w-0">
        <h1 class="truncate font-display text-2xl text-sand-900 sm:text-3xl">
          {{ trip.destination }}
        </h1>
        <div class="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-sand-500 sm:text-sm">
          <span class="inline-flex items-center gap-1">
            <NuxtTime
              :datetime="trip.startDate + 'T00:00:00'"
              locale="en-US"
              month="short"
              day="numeric"
            />
            –
            <NuxtTime
              :datetime="trip.endDate + 'T00:00:00'"
              locale="en-US"
              month="short"
              day="numeric"
              year="numeric"
            />
          </span>
          <span class="text-sand-300">·</span>
          <span>{{ sortedDays.length }} days</span>
          <span class="text-sand-300">·</span>
          <span :class="getTripStatus(trip.startDate, trip.endDate).textClass">
            {{ getTripStatus(trip.startDate, trip.endDate).label }}
          </span>
          <template v-if="trip.preferences?.budget">
            <span class="text-sand-300">·</span>
            <span class="capitalize">{{ trip.preferences.budget }}</span>
          </template>
          <template v-if="trip.preferences?.pace">
            <span class="text-sand-300">·</span>
            <span class="capitalize">{{ trip.preferences.pace }}</span>
          </template>
        </div>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-0.5">
      <button
        v-if="!isViewer"
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-lg text-sand-500 transition hover:bg-sand-100 hover:text-sand-800"
        title="Trip preferences"
        @click="showPrefsEditor = !showPrefsEditor"
      >
        <Icon name="lucide:sliders-horizontal" class="h-4 w-4" />
      </button>

      <!-- Share (owner only). The popover-when-token-exists flow is added in Step 3 below. -->
      <template v-if="tripRole === 'owner'">
        <button
          v-if="!trip.shareToken"
          type="button"
          :disabled="shareLoading"
          class="flex h-9 w-9 items-center justify-center rounded-lg text-sand-500 transition hover:bg-sand-100 hover:text-sand-800 disabled:opacity-50"
          title="Generate share link"
          @click="handleToggleShare"
        >
          <Icon
            :name="shareLoading ? 'lucide:loader' : 'lucide:share-2'"
            class="h-4 w-4"
            :class="{ 'animate-spin': shareLoading }"
          />
        </button>
        <div v-else class="relative">
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-lg text-ocean-600 transition hover:bg-ocean-50"
            :title="shareCopied ? 'Copied!' : 'Share options'"
            @click="showShareMenu = !showShareMenu"
          >
            <Icon
              :name="shareCopied ? 'lucide:check' : 'lucide:link'"
              class="h-4 w-4"
            />
          </button>
          <Transition
            enter-active-class="duration-150 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="duration-100 ease-in"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95"
          >
            <div
              v-if="showShareMenu"
              class="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-sand-200 bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sand-700 hover:bg-sand-50"
                @click="
                  () => {
                    handleCopyShareLink()
                    showShareMenu = false
                  }
                "
              >
                <Icon name="lucide:copy" class="h-4 w-4 text-sand-400" />
                Copy link
              </button>
              <button
                type="button"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                @click="
                  () => {
                    handleToggleShare()
                    showShareMenu = false
                  }
                "
              >
                <Icon name="lucide:link-2-off" class="h-4 w-4" />
                Revoke link
              </button>
            </div>
          </Transition>
        </div>
      </template>

      <!-- More menu -->
      <div class="relative">
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-lg text-sand-500 transition hover:bg-sand-100 hover:text-sand-800"
          title="More options"
          @click="showMoreMenu = !showMoreMenu"
        >
          <Icon name="lucide:more-horizontal" class="h-4 w-4" />
        </button>
        <Transition
          enter-active-class="duration-150 ease-out"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="duration-100 ease-in"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-if="showMoreMenu"
            class="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-sand-200 bg-white py-1 shadow-lg"
          >
            <button
              v-if="!isViewer"
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sand-700 hover:bg-sand-50"
              @click="
                () => {
                  showMoreMenu = false
                  showEditTripModal = true
                }
              "
            >
              <Icon name="lucide:pencil" class="h-4 w-4 text-sand-400" />
              Edit trip
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sand-700 hover:bg-sand-50"
              @click="
                () => {
                  handleExportKml()
                  showMoreMenu = false
                }
              "
            >
              <Icon name="lucide:map" class="h-4 w-4 text-sand-400" />
              Export KML
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sand-700 hover:bg-sand-50"
              @click="
                () => {
                  handleExportPdf()
                  showMoreMenu = false
                }
              "
            >
              <Icon name="lucide:file-down" class="h-4 w-4 text-sand-400" />
              Export PDF
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 3: Add the `showShareMenu` ref to the script.**

  In the `<script setup>` of `[id].vue`, find the existing `const showMoreMenu = ref(false)` declaration. Just below it, add:

  ```ts
  const showShareMenu = ref(false)
  ```

  Then update the click-outside listener that today closes only `showMoreMenu`. Find this block (near the bottom of the script):

  ```ts
  if (import.meta.client) {
    document.addEventListener("click", (e) => {
      if (showMoreMenu.value && !(e.target as HTMLElement).closest(".relative")) {
        showMoreMenu.value = false
      }
    })
  }
  ```

  Replace it with:

  ```ts
  if (import.meta.client) {
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement
      if (showMoreMenu.value && !target.closest(".relative")) {
        showMoreMenu.value = false
      }
      if (showShareMenu.value && !target.closest(".relative")) {
        showShareMenu.value = false
      }
    })
  }
  ```

- [ ] **Step 4: Verify in the browser.**

  With `bun run dev` running, open `http://localhost:3000/trips/<your-trip-id>`. Confirm:
  - Title and dates render with the new quiet meta line below.
  - Status text is the right color for the trip's status (upcoming = ocean, ongoing = forest, completed = sand) — no pill background.
  - Three icons on the right: sliders (preferences), link/share, more.
  - Clicking sliders still toggles the inline preferences panel (we replace it with the sheet in Task 5; behavior unchanged for now).
  - For an owner with a share token, clicking the link icon opens the popover with "Copy link" and "Revoke link". Both work.
  - For a viewer, the sliders icon is hidden, the share icon is hidden, and the More menu does not show "Edit trip".

- [ ] **Step 5: Lint + commit.**

  ```bash
  bun run check
  git add app/pages/trips/\[id\].vue
  git commit -m "refactor(trip): quiet header with icon actions and inline meta line"
  ```

---

## Task 3: Restyle day selector — compact numeric tiles

**Goal:** Replace the row of terra-pill day buttons with compact vertical-stack tiles (number + 3-letter weekday). Active tile is `bg-sand-900`. Today (when not active) is `text-terra-600` with no extra ring.

**Files:**
- Modify: `app/pages/trips/[id].vue`

- [ ] **Step 1: Locate the existing day-tabs block.**

  Find the comment `<!-- Day tabs (client-only to avoid hydration mismatch with sessionStorage) -->` in `[id].vue` (around line 983). The block is wrapped in `<ClientOnly>` and contains a `v-for="day in sortedDays"` button list.

- [ ] **Step 2: Replace the entire `<ClientOnly>` block.**

  ```vue
  <ClientOnly>
    <div class="flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
      <button
        v-for="day in sortedDays"
        :key="day.id"
        type="button"
        class="flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition"
        :class="
          day.id === activeDayId
            ? 'bg-sand-900 text-white'
            : day.date === todayDate
              ? 'text-terra-600 hover:bg-sand-100'
              : 'text-sand-600 hover:bg-sand-100'
        "
        @click="activeDayId = day.id"
      >
        <span class="text-base font-semibold leading-none tabular-nums sm:text-lg">{{
          day.dayNumber
        }}</span>
        <NuxtTime
          class="text-[10px] uppercase tracking-wider opacity-70"
          :datetime="day.date + 'T00:00:00'"
          locale="en-US"
          weekday="short"
        />
      </button>
    </div>
  </ClientOnly>
  ```

- [ ] **Step 3: Verify in the browser.**

  Reload the page. Click between days. Verify:
  - Each day shows the number (large) and 3-letter weekday (small caps).
  - The active day is dark (`bg-sand-900`), white text.
  - If the trip spans today, the today tile is `text-terra-600` when not active. When today is active, the dark `bg-sand-900` wins.
  - The strip scrolls horizontally if more days than fit.

- [ ] **Step 4: Lint + commit.**

  ```bash
  bun run check
  git add app/pages/trips/\[id\].vue
  git commit -m "refactor(trip): compact numeric day selector"
  ```

---

## Task 4: Restyle `TripDetailTabs` — underline + "More" overflow

**Goal:** Five visible tabs (Itinerary, Overview, Expenses, Bookings, More ▾). Active tab has a 2px terra underline. The "More" item dropdown contains Notes, Documents, Team, Flights — clicking activates that tab and the More label keeps a small underline accent.

**Files:**
- Modify: `app/components/TripDetailTabs.vue`

- [ ] **Step 1: Replace the component contents.**

  Open `app/components/TripDetailTabs.vue` and replace the entire file with:

  ```vue
  <script setup lang="ts">
  defineProps<{
    modelValue: string
  }>()

  const emit = defineEmits<{
    "update:modelValue": [value: string]
  }>()

  const primaryTabs = [
    { value: "itinerary", label: "Itinerary" },
    { value: "overview", label: "Overview" },
    { value: "expenses", label: "Expenses" },
    { value: "reservations", label: "Bookings" },
  ] as const

  const overflowTabs = [
    { value: "notes", label: "Notes" },
    { value: "documents", label: "Documents" },
    { value: "team", label: "Team" },
    { value: "flights", label: "Flights" },
  ] as const

  const overflowOpen = ref(false)

  function pick(value: string) {
    emit("update:modelValue", value)
    overflowOpen.value = false
  }

  if (import.meta.client) {
    document.addEventListener("click", (e) => {
      if (
        overflowOpen.value &&
        !(e.target as HTMLElement).closest("[data-tabs-more]")
      ) {
        overflowOpen.value = false
      }
    })
  }
  </script>

  <template>
    <div class="flex items-end gap-6 overflow-x-auto border-b border-sand-200 scrollbar-thin">
      <button
        v-for="tab in primaryTabs"
        :key="tab.value"
        type="button"
        class="relative shrink-0 py-2.5 text-sm transition"
        :class="
          modelValue === tab.value
            ? 'font-medium text-sand-900'
            : 'text-sand-500 hover:text-sand-800'
        "
        @click="pick(tab.value)"
      >
        {{ tab.label }}
        <span
          v-if="modelValue === tab.value"
          class="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-terra-500"
        />
      </button>

      <div data-tabs-more class="relative shrink-0">
        <button
          type="button"
          class="relative inline-flex items-center gap-1 py-2.5 text-sm transition"
          :class="
            overflowTabs.some((t) => t.value === modelValue)
              ? 'font-medium text-sand-900'
              : 'text-sand-500 hover:text-sand-800'
          "
          @click="overflowOpen = !overflowOpen"
        >
          More
          <Icon name="lucide:chevron-down" class="h-3 w-3" />
          <span
            v-if="overflowTabs.some((t) => t.value === modelValue)"
            class="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-terra-500"
          />
        </button>
        <Transition
          enter-active-class="duration-150 ease-out"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="duration-100 ease-in"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-if="overflowOpen"
            class="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-sand-200 bg-white py-1 shadow-lg"
          >
            <button
              v-for="tab in overflowTabs"
              :key="tab.value"
              type="button"
              class="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-sand-50"
              :class="modelValue === tab.value ? 'text-sand-900 font-medium' : 'text-sand-700'"
              @click="pick(tab.value)"
            >
              {{ tab.label }}
              <Icon
                v-if="modelValue === tab.value"
                name="lucide:check"
                class="h-3.5 w-3.5 text-terra-500"
              />
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </template>
  ```

- [ ] **Step 2: Verify in the browser.**

  Reload. Click each visible tab — the underline accent moves to the active one. Click "More ▾" — the dropdown opens. Click "Documents" — the panel switches to the Documents tab and the More button keeps an underline accent. Click outside the dropdown — it closes.

- [ ] **Step 3: Lint + commit.**

  ```bash
  bun run check
  git add app/components/TripDetailTabs.vue
  git commit -m "refactor(trip-tabs): underline tabs with More overflow"
  ```

---

## Task 5: `TripPreferencesSheet` component + wire-up

**Goal:** Replace the inline preferences `<div>` with a slide-up sheet on mobile / right-side drawer on desktop. Same four fields, same handlers — only the wrapper moves.

**Files:**
- Create: `app/components/TripPreferencesSheet.vue`
- Modify: `app/pages/trips/[id].vue`

- [ ] **Step 1: Create the component.**

  Write `app/components/TripPreferencesSheet.vue`:

  ```vue
  <script setup lang="ts">
  import type { TripResponse } from "~/types/trip"

  defineProps<{
    open: boolean
    trip: TripResponse
    currencyConverting: boolean
  }>()

  const emit = defineEmits<{
    close: []
    updatePreference: [key: string, value: string | string[]]
    changeCurrency: [newCurrency: string]
  }>()

  const currencies = [
    { code: "USD", label: "USD ($)" },
    { code: "EUR", label: "EUR (€)" },
    { code: "GBP", label: "GBP (£)" },
    { code: "JPY", label: "JPY (¥)" },
    { code: "KRW", label: "KRW (₩)" },
    { code: "THB", label: "THB (฿)" },
    { code: "SGD", label: "SGD (S$)" },
    { code: "AUD", label: "AUD (A$)" },
    { code: "CAD", label: "CAD (C$)" },
    { code: "MYR", label: "MYR (RM)" },
    { code: "IDR", label: "IDR (Rp)" },
    { code: "TWD", label: "TWD (NT$)" },
    { code: "VND", label: "VND (₫)" },
    { code: "PHP", label: "PHP (₱)" },
    { code: "INR", label: "INR (₹)" },
    { code: "CNY", label: "CNY (¥)" },
  ] as const

  function onEsc(e: KeyboardEvent) {
    if (e.key === "Escape") emit("close")
  }

  watchEffect(() => {
    if (import.meta.client) {
      document.removeEventListener("keydown", onEsc)
      document.addEventListener("keydown", onEsc)
    }
  })

  onUnmounted(() => {
    if (import.meta.client) document.removeEventListener("keydown", onEsc)
  })
  </script>

  <template>
    <!-- Backdrop (mobile only) -->
    <Transition
      enter-active-class="duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-30 bg-sand-900/30 backdrop-blur-[2px] lg:hidden"
        @click="emit('close')"
      />
    </Transition>

    <!-- Sheet (mobile bottom / desktop right drawer) -->
    <Transition
      enter-active-class="duration-200 ease-out"
      enter-from-class="translate-y-full lg:translate-y-0 lg:translate-x-full"
      enter-to-class="translate-y-0 lg:translate-x-0"
      leave-active-class="duration-150 ease-in"
      leave-from-class="translate-y-0 lg:translate-x-0"
      leave-to-class="translate-y-full lg:translate-y-0 lg:translate-x-full"
    >
      <div
        v-if="open"
        class="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-sand-200 bg-white p-5 shadow-2xl lg:bottom-auto lg:right-0 lg:top-0 lg:h-full lg:w-96 lg:max-h-none lg:rounded-none lg:rounded-l-2xl"
      >
        <div class="flex items-center justify-between">
          <h3 class="font-display text-lg text-sand-900">Trip preferences</h3>
          <button
            type="button"
            class="rounded-lg p-1 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
            aria-label="Close"
            @click="emit('close')"
          >
            <Icon name="lucide:x" class="h-4 w-4" />
          </button>
        </div>
        <p class="mt-1 text-xs text-sand-500">AI suggestions will respect these preferences.</p>

        <div class="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-xs font-medium text-sand-500">Budget</label>
            <select
              :value="trip.preferences?.budget || ''"
              class="input-focus mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
              @change="
                emit('updatePreference', 'budget', ($event.target as HTMLSelectElement).value)
              "
            >
              <option value="">Any</option>
              <option value="budget">Budget</option>
              <option value="moderate">Moderate</option>
              <option value="luxury">Luxury</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-sand-500">Pace</label>
            <select
              :value="trip.preferences?.pace || ''"
              class="input-focus mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
              @change="
                emit('updatePreference', 'pace', ($event.target as HTMLSelectElement).value)
              "
            >
              <option value="">Any</option>
              <option value="relaxed">Relaxed</option>
              <option value="moderate">Moderate</option>
              <option value="packed">Packed</option>
            </select>
          </div>

          <div class="sm:col-span-2">
            <label class="block text-xs font-medium text-sand-500">Currency</label>
            <select
              :value="trip.currencyCode || 'USD'"
              :disabled="currencyConverting"
              class="input-focus mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm disabled:opacity-50"
              @change="emit('changeCurrency', ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="c in currencies" :key="c.code" :value="c.code">{{ c.label }}</option>
            </select>
          </div>

          <div class="sm:col-span-2">
            <label class="block text-xs font-medium text-sand-500">Interests</label>
            <input
              :value="trip.preferences?.interests?.join(', ') || ''"
              type="text"
              placeholder="e.g. temples, street food, nature, nightlife"
              class="input-focus mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
              @change="
                emit(
                  'updatePreference',
                  'interests',
                  ($event.target as HTMLInputElement).value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              "
            />
          </div>
        </div>
      </div>
    </Transition>
  </template>
  ```

- [ ] **Step 2: Replace the inline preferences div in `[id].vue`.**

  In `app/pages/trips/[id].vue`, find the comment `<!-- Preferences editor -->` (around line 878). Delete the entire block from `<!-- Preferences editor -->` through its closing `</div>` (around line 962 — the one followed by `<!-- Tabs -->`).

  Then, near the bottom of the `<template>` where other modals are mounted (just before `<!-- Edit modal -->`, around line 1333), add:

  ```vue
  <TripPreferencesSheet
    v-if="trip && !isViewer"
    :open="showPrefsEditor"
    :trip="trip"
    :currency-converting="currencyConverting"
    @close="showPrefsEditor = false"
    @update-preference="updatePreference"
    @change-currency="handleCurrencyChange"
  />
  ```

- [ ] **Step 3: Verify in the browser.**

  Reload. Click the sliders icon in the header. Confirm:
  - On mobile (narrow viewport), the sheet slides up from the bottom and a dim backdrop appears. Tapping the backdrop dismisses it.
  - On desktop (`>= lg`), the sheet slides in from the right edge, no dim backdrop.
  - ESC closes the sheet.
  - Changing Budget / Pace / Currency / Interests still updates the trip (look for the chips in the header meta line to update).
  - The currency change still triggers the existing convert-currency confirm dialog.

- [ ] **Step 4: Lint + commit.**

  ```bash
  bun run check
  git add app/components/TripPreferencesSheet.vue app/pages/trips/\[id\].vue
  git commit -m "refactor(trip): preferences as slide-up sheet"
  ```

---

## Task 6: Extract `useAiPromptSuggestions` composable

**Goal:** Move the destination-aware suggestion list out of the (soon-deleted) `AiPromptSuggestions.vue` component into a composable so the dock can consume it.

**Files:**
- Create: `app/composables/useAiPromptSuggestions.ts`

- [ ] **Step 1: Create the composable.**

  Write `app/composables/useAiPromptSuggestions.ts`:

  ```ts
  import { computed, type Ref } from "vue"

  export function useAiPromptSuggestions(
    destination: Ref<string>,
    hasActivities: Ref<boolean>,
  ) {
    const emptyDaySuggestions = computed(() => [
      `Plan my full day in ${destination.value}`,
      "Find breakfast, lunch, and dinner spots",
      "Mix cultural sites with food stops",
      "Suggest hidden gems and local favorites",
    ])

    const withActivitiesSuggestions = [
      "Add a coffee shop nearby",
      "Move dinner to 7 PM",
      "Remove the museum",
      "Optimize the route",
      "Fill the gaps",
      "Find a hotel nearby",
    ]

    const suggestions = computed(() =>
      hasActivities.value ? withActivitiesSuggestions : emptyDaySuggestions.value,
    )

    return { suggestions }
  }
  ```

- [ ] **Step 2: Verify the composable type-checks.**

  ```bash
  bun run check
  ```

  Expected: 0 errors.

- [ ] **Step 3: Commit.**

  ```bash
  git add app/composables/useAiPromptSuggestions.ts
  git commit -m "feat(ai): extract prompt suggestions into composable"
  ```

---

## Task 7: Extract `useGenerateFullItinerary` composable

**Goal:** Move the per-day-loop logic out of `GenerateFullItineraryButton.vue` into a composable so the dock's "Generate full itinerary" chip can reuse it.

**Files:**
- Create: `app/composables/useGenerateFullItinerary.ts`

- [ ] **Step 1: Create the composable.**

  Write `app/composables/useGenerateFullItinerary.ts`:

  ```ts
  import { ref } from "vue"

  type DayWithActivities = {
    id: string
    dayNumber: number
    activities: { id: string }[]
  }

  export function useGenerateFullItinerary(tripId: string) {
    const { confirm } = useConfirm()

    const running = ref(false)
    const currentDayIndex = ref(0)
    const errorMessage = ref("")

    async function run(days: DayWithActivities[], aiRemaining?: number): Promise<boolean> {
      const emptyDays = days.filter((d) => d.activities.length === 0)
      if (emptyDays.length === 0) return false

      // Pre-check quota
      if (aiRemaining != null && aiRemaining < emptyDays.length) {
        const ok = await confirm({
          title: "Not enough AI prompts",
          message: `You need ${emptyDays.length} prompts but only have ${aiRemaining} remaining this month. Generate as many as possible?`,
          confirmText: "Continue anyway",
        })
        if (!ok) return false
      } else {
        const ok = await confirm({
          title: "Generate full itinerary",
          message: `This will use AI to fill ${emptyDays.length} empty day${emptyDays.length > 1 ? "s" : ""}. Each day costs 1 AI prompt.`,
          confirmText: "Generate",
        })
        if (!ok) return false
      }

      running.value = true
      errorMessage.value = ""

      for (let i = 0; i < emptyDays.length; i++) {
        const day = emptyDays[i]!
        currentDayIndex.value = i
        try {
          await $fetch(`/api/trips/${tripId}/days/${day.id}/ai`, {
            method: "POST",
            body: {
              prompt: "Plan this day with a good mix of activities, food, and sightseeing",
            },
          })
        } catch {
          errorMessage.value = `Generated ${i} of ${emptyDays.length} days. Day ${day.dayNumber} failed — try again manually.`
          running.value = false
          return true
        }
      }

      running.value = false
      return true
    }

    return { run, running, currentDayIndex, errorMessage }
  }
  ```

  Note: this calls `useConfirm` which is auto-imported in Nuxt 4 (it's defined in `app/composables/useConfirm.ts`). `$fetch` is also a Nuxt global, no import needed.

- [ ] **Step 2: Type-check.**

  ```bash
  bun run check
  ```

- [ ] **Step 3: Commit.**

  ```bash
  git add app/composables/useGenerateFullItinerary.ts
  git commit -m "feat(ai): extract full-itinerary loop into composable"
  ```

---

## Task 8: Build `AiDock` skeleton — idle and focused-typing states

**Goal:** Create the dock component with the input, sparkle, usage counter, and send button. Wire it to the same `submitAiPrompt` / `aiPrompt` / `aiUsage` props/emits the parent will pass. No reveal-zone yet — that comes in Task 9.

**Files:**
- Create: `app/components/AiDock.vue`

- [ ] **Step 1: Create the component skeleton.**

  Write `app/components/AiDock.vue`:

  ```vue
  <script setup lang="ts">
  import { BorderBeam } from "vue-border-beam"

  const props = defineProps<{
    modelValue: string
    loading: boolean
    loadingMode: "generate" | "optimize" | "remove" | "reschedule"
    usageUsed: number | null
    usageLimit: number | null
    usageRemaining: number | null
    hasActivities: boolean
    destination: string
    feedbackMessage: string
    feedbackError: string
    undoAvailable: boolean
    undoing: boolean
  }>()

  const emit = defineEmits<{
    "update:modelValue": [value: string]
    submit: [prompt: string]
    cancel: []
    undo: []
    dismissFeedback: []
    fillGaps: []
    optimizeRoute: []
    generateFull: []
  }>()

  const inputEl = ref<HTMLInputElement | null>(null)
  const focused = ref(false)

  const limitReached = computed(() => (props.usageRemaining ?? 1) <= 0)

  const placeholder = computed(() => {
    if (limitReached.value) return "Limit reached. Resets next month."
    if (props.loading) {
      switch (props.loadingMode) {
        case "optimize": return "Optimizing route…"
        case "remove": return "Removing stops…"
        case "reschedule": return "Rescheduling…"
        default: return "Generating activities…"
      }
    }
    return props.hasActivities
      ? "Add, remove, reschedule, find a hotel…"
      : "What to do today?"
  })

  function handleSubmit() {
    if (props.loading || !props.modelValue.trim() || limitReached.value) return
    emit("submit", props.modelValue.trim())
  }

  function handleClick() {
    if (props.loading) {
      emit("cancel")
    } else {
      handleSubmit()
    }
  }
  </script>

  <template>
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-3 sm:pb-5">
      <div class="pointer-events-auto mx-auto flex w-full max-w-[480px] justify-center">
        <BorderBeam
          size="sm"
          color-variant="sunset"
          theme="dark"
          :brightness="0.4"
          :strength="0.3"
          :saturation="0.8"
          :duration="4"
          class="w-full"
        >
          <div
            class="flex items-center gap-2 rounded-full bg-sand-900 py-2 pl-4 pr-2 shadow-[0_12px_28px_-8px_rgba(28,26,20,.5)]"
            :class="{ 'dock-shimmer': loading }"
          >
            <Icon
              name="lucide:sparkles"
              class="h-4 w-4 shrink-0 text-terra-300"
              :class="{ 'animate-spin': loading }"
            />
            <input
              ref="inputEl"
              :value="modelValue"
              type="text"
              :disabled="loading || limitReached"
              :placeholder="placeholder"
              class="min-w-0 flex-1 border-none bg-transparent text-sm text-white placeholder:text-white/55 focus:outline-none disabled:opacity-70"
              @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
              @focus="focused = true"
              @blur="focused = false"
              @keydown.enter.prevent="handleSubmit"
            />
            <span
              v-if="usageUsed != null && usageLimit != null"
              class="shrink-0 text-[10px] tabular-nums"
              :class="(usageRemaining ?? 1) <= 10 ? 'text-terra-300 font-medium' : 'text-white/40'"
              :title="`${usageUsed}/${usageLimit} AI prompts used this month`"
            >
              {{ usageUsed }}/{{ usageLimit }}
            </span>
            <button
              type="button"
              :disabled="!loading && (!modelValue.trim() || limitReached)"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-50"
              :class="loading ? 'bg-sand-600 hover:bg-sand-500' : 'bg-terra-500 hover:bg-terra-600'"
              :title="loading ? 'Cancel' : 'Submit'"
              @click="handleClick"
            >
              <Icon
                :name="loading ? 'lucide:x' : 'lucide:arrow-up'"
                class="h-4 w-4"
              />
            </button>
          </div>
        </BorderBeam>
      </div>
    </div>
  </template>

  <style scoped>
  .dock-shimmer {
    background: linear-gradient(90deg, #1c1a14 0%, #4a4639 50%, #1c1a14 100%);
    background-size: 200% 100%;
    animation: shimmer 2s ease infinite;
  }

  @keyframes shimmer {
    0% { background-position: 0 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .dock-shimmer {
      background: #2c2a22;
      animation: none;
    }
    .animate-spin {
      animation: none;
    }
  }
  </style>
  ```

- [ ] **Step 2: Type-check.**

  ```bash
  bun run check
  ```

- [ ] **Step 3: Commit.**

  ```bash
  git add app/components/AiDock.vue
  git commit -m "feat(ai-dock): scaffold floating dock with input and send/cancel"
  ```

---

## Task 9: `AiDock` reveal zone — quick action and suggestion chips

**Goal:** Add the "above the dock" reveal zone. When the input is focused (or the dock is hovered) the zone shows three quick-action chips. When the input is focused, empty, and stays empty for 600ms, the zone replaces the chips with destination-specific suggestion chips.

**Files:**
- Modify: `app/components/AiDock.vue`

- [ ] **Step 1: Add the reveal-zone state machine to the script.**

  In the existing `<script setup>`, just below `const focused = ref(false)`, add:

  ```ts
  type RevealMode = "none" | "quick" | "suggestions"

  const hovered = ref(false)
  const revealMode = ref<RevealMode>("none")
  let suggestionTimer: ReturnType<typeof setTimeout> | null = null

  function clearSuggestionTimer() {
    if (suggestionTimer) {
      clearTimeout(suggestionTimer)
      suggestionTimer = null
    }
  }

  watch(
    [focused, hovered, () => props.modelValue, () => props.loading],
    ([isFocused, isHovered, value, isLoading]) => {
      clearSuggestionTimer()

      if (isLoading) {
        revealMode.value = "none"
        return
      }
      if (!isFocused && !isHovered) {
        revealMode.value = "none"
        return
      }
      if (value.trim().length > 0) {
        revealMode.value = "quick"
        return
      }
      // Focused + empty → quick first, then suggestions after 600ms
      revealMode.value = "quick"
      if (isFocused) {
        suggestionTimer = setTimeout(() => {
          revealMode.value = "suggestions"
        }, 600)
      }
    },
    { immediate: true },
  )

  onUnmounted(clearSuggestionTimer)

  const destinationRef = computed(() => props.destination)
  const hasActivitiesRef = computed(() => props.hasActivities)
  const { suggestions } = useAiPromptSuggestions(destinationRef, hasActivitiesRef)

  function selectSuggestion(text: string) {
    emit("update:modelValue", text)
    nextTick(() => inputEl.value?.focus())
  }
  ```

- [ ] **Step 2: Add the reveal zone to the template.**

  Inside the outer `<div class="pointer-events-none fixed …">` and immediately above the `<div class="pointer-events-auto mx-auto …">`, insert:

  ```vue
  <Transition
    enter-active-class="duration-150 ease-out"
    enter-from-class="opacity-0 translate-y-1"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="duration-100 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-1"
  >
    <div
      v-if="revealMode === 'quick'"
      class="pointer-events-auto mx-auto mb-2 flex max-w-[480px] flex-wrap justify-center gap-1.5"
    >
      <button
        type="button"
        :disabled="loading"
        class="rounded-full border border-sand-200 bg-white/95 px-3 py-1 text-xs text-sand-700 shadow-sm transition hover:border-terra-300 hover:text-terra-700"
        @mousedown.prevent
        @click="emit('fillGaps')"
      >
        <Icon name="lucide:wand-2" class="mr-1 inline h-3 w-3" />
        Fill gaps
      </button>
      <button
        type="button"
        :disabled="loading || !hasActivities"
        class="rounded-full border border-sand-200 bg-white/95 px-3 py-1 text-xs text-sand-700 shadow-sm transition hover:border-terra-300 hover:text-terra-700 disabled:opacity-40"
        @mousedown.prevent
        @click="emit('optimizeRoute')"
      >
        <Icon name="lucide:route" class="mr-1 inline h-3 w-3" />
        Optimize route
      </button>
      <button
        type="button"
        :disabled="loading"
        class="rounded-full border border-sand-200 bg-white/95 px-3 py-1 text-xs text-sand-700 shadow-sm transition hover:border-terra-300 hover:text-terra-700"
        @mousedown.prevent
        @click="emit('generateFull')"
      >
        <Icon name="lucide:sparkles" class="mr-1 inline h-3 w-3" />
        Generate full itinerary
      </button>
    </div>
    <div
      v-else-if="revealMode === 'suggestions'"
      class="pointer-events-auto mx-auto mb-2 flex max-w-[480px] flex-wrap justify-center gap-1.5"
    >
      <button
        v-for="s in suggestions"
        :key="s"
        type="button"
        class="rounded-full border border-sand-200 bg-white/95 px-3 py-1 text-xs text-sand-600 shadow-sm transition hover:border-terra-300 hover:text-terra-700"
        @mousedown.prevent
        @click="selectSuggestion(s)"
      >
        {{ s }}
      </button>
    </div>
  </Transition>
  ```

  Note: `@mousedown.prevent` on each chip prevents the input from losing focus when clicking a chip (otherwise the reveal zone would close mid-click).

- [ ] **Step 3: Add hover handlers to the dock pill itself.**

  On the `<div class="flex items-center gap-2 rounded-full bg-sand-900 …">` (the pill div, the one inside `<BorderBeam>`), add `@mouseenter="hovered = true"` and `@mouseleave="hovered = false"`.

- [ ] **Step 4: Verify in isolation.**

  Since the dock isn't wired up yet, mount it temporarily in `[id].vue` for visual smoke testing — at the bottom of the `<div v-else>` (just before the closing `</div>` and the lazy modals), add:

  ```vue
  <AiDock
    v-if="activeTab === 'itinerary'"
    v-model="aiPrompt"
    :loading="aiLoading"
    :loading-mode="aiLoadingMode"
    :usage-used="aiUsage?.used ?? null"
    :usage-limit="aiUsage?.limit ?? null"
    :usage-remaining="aiUsage?.remaining ?? null"
    :has-activities="activeDayHasActivities"
    :destination="trip.destination"
    feedback-message=""
    feedback-error=""
    :undo-available="false"
    :undoing="false"
  />
  ```

  Reload the page. The dock floats at the bottom. Hover it → quick-action chips fade in above. Click into the input → chips stay visible. Wait ~600ms with empty input → suggestion chips appear. Type a character → back to quick chips. Click a suggestion chip → it populates the input.

  Don't commit this temporary mount yet; it gets finalized in Task 12.

- [ ] **Step 5: Lint + commit (just the AiDock changes).**

  ```bash
  bun run check
  git add app/components/AiDock.vue
  git commit -m "feat(ai-dock): reveal-zone with quick actions and suggestion chips"
  ```

---

## Task 10: `AiDock` loading state — cycling status text

**Goal:** While `loading` is true, the dock shimmers and the placeholder cycles through the existing per-mode step strings (preserving the warmth of the deleted `AiLoadingOverlay`).

**Files:**
- Modify: `app/components/AiDock.vue`

- [ ] **Step 1: Add the per-mode step library.**

  In the `<script setup>`, just under the `placeholder` computed, add:

  ```ts
  const stepSets = {
    generate: [
      "Searching travel blogs & local guides…",
      "Finding hidden gems & local favorites…",
      "Validating places on Google Maps…",
      "Building your itinerary…",
    ],
    optimize: [
      "Researching routes & transit options…",
      "Calculating optimal order…",
      "Assigning realistic times…",
    ],
    remove: ["Identifying activities to remove…", "Updating your itinerary…"],
    reschedule: ["Analyzing your current schedule…", "Adjusting times and order…"],
  } as const

  const cycleIndex = ref(0)
  let cycleTimer: ReturnType<typeof setInterval> | null = null

  function startCycle() {
    if (cycleTimer) clearInterval(cycleTimer)
    cycleIndex.value = 0
    cycleTimer = setInterval(() => {
      const steps = stepSets[props.loadingMode] ?? stepSets.generate
      cycleIndex.value = (cycleIndex.value + 1) % steps.length
    }, 2500)
  }

  function stopCycle() {
    if (cycleTimer) clearInterval(cycleTimer)
    cycleTimer = null
    cycleIndex.value = 0
  }

  watch(
    () => props.loading,
    (isLoading) => {
      if (isLoading) startCycle()
      else stopCycle()
    },
  )

  onUnmounted(stopCycle)

  const loadingPlaceholder = computed(() => {
    const steps = stepSets[props.loadingMode] ?? stepSets.generate
    return steps[cycleIndex.value % steps.length]!
  })
  ```

- [ ] **Step 2: Update the `placeholder` computed to use the cycling text.**

  Replace the existing `placeholder` computed with:

  ```ts
  const placeholder = computed(() => {
    if (limitReached.value) return "Limit reached. Resets next month."
    if (props.loading) return loadingPlaceholder.value
    return props.hasActivities
      ? "Add, remove, reschedule, find a hotel…"
      : "What to do today?"
  })
  ```

- [ ] **Step 3: Verify in the browser.**

  With the temp dock mount from Task 9 still in place: type a prompt, hit submit. The dock should shimmer, the sparkle should rotate, and the placeholder should cycle every 2.5s through the appropriate step set. The send button should swap to ✕ — clicking it currently does nothing because Task 12 wires the cancel handler.

- [ ] **Step 4: Lint + commit.**

  ```bash
  bun run check
  git add app/components/AiDock.vue
  git commit -m "feat(ai-dock): loading shimmer with cycling status text"
  ```

---

## Task 11: `AiDock` feedback toast — success / error / undo

**Goal:** When `feedbackMessage` or `feedbackError` is non-empty, render a toast in the reveal zone above the dock. Success toasts auto-dismiss after 6s; error toasts are sticky until ✕.

**Files:**
- Modify: `app/components/AiDock.vue`

- [ ] **Step 1: Add the toast state machine to the script.**

  Below the existing `revealMode` watcher, add a parallel `feedbackVisible` state:

  ```ts
  const feedbackVisible = ref(false)
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  function clearToastTimer() {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
  }

  watch(
    [() => props.feedbackMessage, () => props.feedbackError],
    ([message, error]) => {
      clearToastTimer()
      if (error) {
        // Sticky until dismissed
        feedbackVisible.value = true
      } else if (message) {
        feedbackVisible.value = true
        // Respect prefers-reduced-motion: still auto-dismiss, just no fade
        toastTimer = setTimeout(() => {
          emit("dismissFeedback")
        }, 6000)
      } else {
        feedbackVisible.value = false
      }
    },
  )

  onUnmounted(clearToastTimer)
  ```

- [ ] **Step 2: Add the toast template inside the existing reveal-zone `<Transition>`.**

  Inside the outer `<Transition>` you added in Task 9, add a third `v-else-if` branch that wins precedence over `quick` and `suggestions` when feedback is showing.

  Update the reveal-zone block. Replace its outer `<Transition>` content with:

  ```vue
  <Transition
    enter-active-class="duration-150 ease-out"
    enter-from-class="opacity-0 translate-y-1"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="duration-100 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-1"
  >
    <div
      v-if="feedbackVisible && (feedbackMessage || feedbackError)"
      class="pointer-events-auto mx-auto mb-2 max-w-[480px]"
    >
      <div
        v-if="feedbackError"
        class="flex items-start gap-2 rounded-xl bg-terra-50 px-3 py-2 text-sm text-terra-700 shadow-sm"
      >
        <Icon name="lucide:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
        <span class="flex-1">{{ feedbackError }}</span>
        <button
          type="button"
          class="shrink-0 text-terra-400 hover:text-terra-700"
          @click="emit('dismissFeedback')"
        >
          <Icon name="lucide:x" class="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        v-else
        class="flex items-center gap-2 rounded-xl bg-forest-50 px-3 py-2 text-sm text-forest-700 shadow-sm"
      >
        <Icon name="lucide:check-circle" class="h-4 w-4 shrink-0" />
        <span class="flex-1">{{ feedbackMessage }}</span>
        <button
          v-if="undoAvailable"
          type="button"
          :disabled="undoing"
          class="shrink-0 text-sm font-medium text-forest-700 underline underline-offset-2 hover:text-forest-900 disabled:opacity-50"
          @click="emit('undo')"
        >
          <span v-if="undoing">Undoing…</span>
          <span v-else>Undo</span>
        </button>
        <button
          type="button"
          class="shrink-0 text-forest-400 hover:text-forest-700"
          @click="emit('dismissFeedback')"
        >
          <Icon name="lucide:x" class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
    <div
      v-else-if="revealMode === 'quick'"
      class="pointer-events-auto mx-auto mb-2 flex max-w-[480px] flex-wrap justify-center gap-1.5"
    >
      <!-- existing quick-actions chips block from Task 9 — leave as-is -->
      <button
        type="button"
        :disabled="loading"
        class="rounded-full border border-sand-200 bg-white/95 px-3 py-1 text-xs text-sand-700 shadow-sm transition hover:border-terra-300 hover:text-terra-700"
        @mousedown.prevent
        @click="emit('fillGaps')"
      >
        <Icon name="lucide:wand-2" class="mr-1 inline h-3 w-3" />
        Fill gaps
      </button>
      <button
        type="button"
        :disabled="loading || !hasActivities"
        class="rounded-full border border-sand-200 bg-white/95 px-3 py-1 text-xs text-sand-700 shadow-sm transition hover:border-terra-300 hover:text-terra-700 disabled:opacity-40"
        @mousedown.prevent
        @click="emit('optimizeRoute')"
      >
        <Icon name="lucide:route" class="mr-1 inline h-3 w-3" />
        Optimize route
      </button>
      <button
        type="button"
        :disabled="loading"
        class="rounded-full border border-sand-200 bg-white/95 px-3 py-1 text-xs text-sand-700 shadow-sm transition hover:border-terra-300 hover:text-terra-700"
        @mousedown.prevent
        @click="emit('generateFull')"
      >
        <Icon name="lucide:sparkles" class="mr-1 inline h-3 w-3" />
        Generate full itinerary
      </button>
    </div>
    <div
      v-else-if="revealMode === 'suggestions'"
      class="pointer-events-auto mx-auto mb-2 flex max-w-[480px] flex-wrap justify-center gap-1.5"
    >
      <button
        v-for="s in suggestions"
        :key="s"
        type="button"
        class="rounded-full border border-sand-200 bg-white/95 px-3 py-1 text-xs text-sand-600 shadow-sm transition hover:border-terra-300 hover:text-terra-700"
        @mousedown.prevent
        @click="selectSuggestion(s)"
      >
        {{ s }}
      </button>
    </div>
  </Transition>
  ```

  This keeps the same `<Transition>` wrapper but adds the feedback branch as the highest-precedence `v-if`. (Vue's `v-if`/`v-else-if`/`v-else` chain only renders one child, which is exactly what we want.)

- [ ] **Step 3: Lint + commit.**

  ```bash
  bun run check
  git add app/components/AiDock.vue
  git commit -m "feat(ai-dock): success/error toast with undo and dismiss"
  ```

---

## Task 12: Wire `AiDock` into `[id].vue`, add `AbortController`, remove old AI block

**Goal:** Connect the dock to the page's existing `submitAiPrompt` / `handleUndo` / quick-action handlers. Add a cancel path. Delete the old `AiQuickActions`, `AiPromptSuggestions`, `BorderBeam` input form, `AiLoadingOverlay`, and `GenerateFullItineraryButton` from the page (their files are deleted in Task 13).

**Files:**
- Modify: `app/pages/trips/[id].vue`

- [ ] **Step 1: Add the abort controller and cancel handler to the script.**

  In `<script setup>` of `[id].vue`, find `const aiLoading = ref(false)`. Just below it, add:

  ```ts
  const aiAbortController = ref<AbortController | null>(null)
  ```

  Then replace the entire body of `submitAiPrompt` (everything inside the function braces) with this version. The function signature stays unchanged; only the body is replaced:

  ```ts
  async function submitAiPrompt(prompt: string) {
    if (!activeDayId.value || !prompt.trim()) return
    aiPrompt.value = ""
    aiError.value = ""
    aiMessage.value = ""
    aiLoading.value = true

    // Snapshot current activities for undo
    lastSnapshot.value = JSON.stringify(activeDay.value?.activities ?? [])

    // Guess loading mode for the dock placeholder cycler
    if (/\b(optimize|reorder|rearrange|best route|efficient)\b/i.test(prompt)) {
      aiLoadingMode.value = "optimize"
    } else if (/\b(remove|delete|drop|get rid of)\b/i.test(prompt)) {
      aiLoadingMode.value = "remove"
    } else if (
      /\b(reschedule|move.*earlier|move.*later|too late|too early|change.*time)\b/i.test(prompt)
    ) {
      aiLoadingMode.value = "reschedule"
    } else {
      aiLoadingMode.value = "generate"
    }

    try {
      aiAbortController.value = new AbortController()
      const result = await $fetch(`/api/trips/${tripId}/days/${activeDayId.value}/ai`, {
        method: "POST",
        body: { prompt },
        signal: aiAbortController.value.signal,
      })
      aiMessage.value = result.message
      await refresh()
    } catch (e: unknown) {
      const err = e as { name?: string; data?: { message?: string } }
      if (err.name === "AbortError") {
        // Silent cancel — no error toast, no message
        lastSnapshot.value = null
      } else {
        aiError.value = err.data?.message ?? "Something went wrong"
        lastSnapshot.value = null
      }
    } finally {
      aiLoading.value = false
      aiAbortController.value = null
      refreshUsage()
    }
  }
  ```

  And just below `submitAiPrompt`, add:

  ```ts
  function handleAiCancel() {
    aiAbortController.value?.abort()
    aiLoading.value = false
    aiAbortController.value = null
  }
  ```

- [ ] **Step 2: Add the quick-action handlers and full-itinerary handler.**

  In `<script setup>` of `[id].vue`, just below `handleAiCancel`, add:

  ```ts
  const { run: runGenerateFullItinerary } = useGenerateFullItinerary(tripId)

  async function handleGenerateFullItinerary() {
    const ran = await runGenerateFullItinerary(sortedDays.value, aiUsage.value?.remaining)
    if (ran) {
      await refresh()
      await refreshUsage()
    }
  }

  function handleQuickFillGaps() {
    void submitAiPrompt("Fill in the gaps in my schedule for today")
  }

  function handleQuickOptimizeRoute() {
    void submitAiPrompt("Optimize the route and reorder activities for minimum travel time")
  }

  function handleDismissAiFeedback() {
    aiMessage.value = ""
    aiError.value = ""
    lastSnapshot.value = null
  }
  ```

- [ ] **Step 3: Remove the old AI block from the template.**

  In the template, find the comment `<!-- Generate all empty days (experimental) -->` (around line 1017). Delete from that comment through the `</div>` at the end of `<!-- AI prompt bar (hidden for viewers) -->` block (the `</div>` immediately above `<!-- Active day content -->`, around line 1150).

  Concretely: remove the entire `<GenerateFullItineraryButton …>` element AND the entire `<div v-if="activeDay && !isViewer" class="mt-4">…</div>` block that contains the quick-actions row, the BorderBeam form, the prompt suggestions, and the success/error feedback divs. Keep `<!-- Active day content -->` and everything after it.

  Also remove the `<AiLoadingOverlay :visible="aiLoading" :mode="aiLoadingMode" />` line found inside `<DaySection>`'s sibling area (around line 1181) — the dock shimmer replaces it.

- [ ] **Step 4: Mount the `AiDock` once at the bottom of the template.**

  If you added a temporary `<AiDock>` mount during Task 9, replace it with the final wired version. Put this just before the `<!-- Edit modal -->` comment (around line 1333):

  ```vue
  <AiDock
    v-if="activeTab === 'itinerary' && activeDay && !isViewer"
    v-model="aiPrompt"
    :loading="aiLoading"
    :loading-mode="aiLoadingMode"
    :usage-used="aiUsage?.used ?? null"
    :usage-limit="aiUsage?.limit ?? null"
    :usage-remaining="aiUsage?.remaining ?? null"
    :has-activities="activeDayHasActivities"
    :destination="trip.destination"
    :feedback-message="aiMessage"
    :feedback-error="aiError"
    :undo-available="undoAvailable"
    :undoing="undoLoading"
    @submit="submitAiPrompt"
    @cancel="handleAiCancel"
    @undo="handleUndo"
    @dismiss-feedback="handleDismissAiFeedback"
    @fill-gaps="handleQuickFillGaps"
    @optimize-route="handleQuickOptimizeRoute"
    @generate-full="handleGenerateFullItinerary"
  />
  ```

- [ ] **Step 5: Adjust the activities scroll container.**

  Because the dock is now `position: fixed` overlapping the bottom of the viewport, the activities list needs bottom padding so the last activity isn't hidden. Find the left column wrapper for the itinerary content (around line 1156):

  ```html
  <div class="flex-1 space-y-6 lg:max-h-[calc(100vh-320px)] lg:overflow-y-auto lg:pr-4">
  ```

  Change to:

  ```html
  <div class="flex-1 space-y-6 pb-24 lg:max-h-[calc(100vh-320px)] lg:overflow-y-auto lg:pr-4 lg:pb-6">
  ```

  The `pb-24` (96px) on small viewports keeps activities clear of the dock; on `lg:` the scrollable column already has its own bottom edge, so `pb-6` is enough.

- [ ] **Step 6: Verify the full flow in the browser.**

  Reload. On the itinerary tab:
  - Dock floats at the bottom-center.
  - Hover or focus → quick-action chips appear above. Click "Fill gaps" → AI runs (dock shimmers, sparkle spins, placeholder cycles through "Searching travel blogs…" etc.). Send button is now ✕ — clicking it cancels (silent: no error toast, snapshot cleared).
  - Type a prompt and submit → success toast appears with the AI message. If undo is available, the Undo link works and reverts. The toast auto-dismisses in 6s.
  - Trigger a known-bad prompt or hit the rate limit → error toast appears, sticky until ✕.
  - Click "Generate full itinerary" → confirm dialog appears (from `useGenerateFullItinerary`), then the loop runs.
  - Switch to a non-itinerary tab → dock disappears.
  - Switch user role to viewer (if you have one) → dock does not render.

- [ ] **Step 7: Lint + commit.**

  ```bash
  bun run check
  git add app/pages/trips/\[id\].vue
  git commit -m "refactor(trip): wire AiDock and replace inline AI toolbar"
  ```

---

## Task 13: Delete deprecated components

**Goal:** Remove the four components whose responsibilities are now in `AiDock` / the two new composables.

**Files:**
- Delete: `app/components/AiQuickActions.vue`
- Delete: `app/components/AiPromptSuggestions.vue`
- Delete: `app/components/AiLoadingOverlay.vue`
- Delete: `app/components/GenerateFullItineraryButton.vue`

- [ ] **Step 1: Confirm none of these are imported anywhere except `[id].vue`.**

  ```bash
  grep -rn "AiQuickActions\|AiPromptSuggestions\|AiLoadingOverlay\|GenerateFullItineraryButton" app/ --include="*.vue" --include="*.ts"
  ```

  Expected: only matches inside the four component files themselves. Any matches in `app/pages/trips/[id].vue` mean Task 12 left a dangling reference — go fix it before deleting.

- [ ] **Step 2: Delete the files.**

  ```bash
  rm app/components/AiQuickActions.vue \
     app/components/AiPromptSuggestions.vue \
     app/components/AiLoadingOverlay.vue \
     app/components/GenerateFullItineraryButton.vue
  ```

- [ ] **Step 3: Verify Nuxt's auto-import scan still type-checks.**

  ```bash
  bun run check
  ```

  Expected: 0 errors.

- [ ] **Step 4: Reload the dev server (Nuxt sometimes caches deleted auto-imports).**

  In the terminal running `bun run dev`, press `Ctrl+C` and restart. Open the trip page once more and re-run the smoke test from Task 12 Step 6. Everything should still work.

- [ ] **Step 5: Commit.**

  ```bash
  git add -A app/components/
  git commit -m "chore(trip): delete deprecated AI toolbar components"
  ```

---

## Task 14: Final visual verification + viewer-role audit

**Goal:** A single end-to-end smoke pass against every change. This is the catch-all to make sure no edge case slipped.

- [ ] **Step 1: Owner flow.**

  As an owner, on a trip with mixed empty and populated days:

  - Header: title, dates, day count, status (correct color), budget, pace all visible as quiet inline text. Three icons on the right.
  - Click sliders → preferences sheet slides up (mobile) / from the right (desktop). Change budget — header updates. Change currency — convert dialog appears.
  - Click link icon (no token yet) → token generated and link copied.
  - Click link icon (token exists) → popover with Copy / Revoke. Both work.
  - Click ⋯ → Edit trip / Export KML / Export PDF all work.
  - Click each primary tab — underline accent moves. Click "More ▾" → dropdown opens. Click Documents → Documents panel renders, More button shows underline accent.
  - Click each day tile — active tile dark, today tile terra-colored when not active.
  - Hover dock → quick chips appear. Focus dock with empty input, wait — suggestions appear. Run "Fill gaps" → dock shimmers, success toast appears, undo works.
  - Run a prompt that returns an error (try a deliberately confused prompt) → error toast sticks until ✕.
  - Switch tabs while AI is running — dock cancellation should not fire (only the explicit ✕ should). Confirm the in-flight request still completes.

- [ ] **Step 2: Viewer flow.**

  Open the same trip as a viewer (someone with `_role: "viewer"` from the members API):

  - Sliders icon hidden.
  - Share icon hidden.
  - More menu hidden in non-itinerary tabs (or only shows non-edit items).
  - Dock not rendered.
  - All read-only data still visible.

- [ ] **Step 3: Mobile width.**

  Resize the browser to ~390px wide (iPhone). Confirm:

  - Header still legible — meta line wraps if needed.
  - Day tiles scroll horizontally.
  - Tabs scroll horizontally.
  - Dock width is viewport minus 16px gutter.
  - Dock placement does not overlap the safe-area inset on iOS Safari.

- [ ] **Step 4: Reduced motion.**

  Open DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`. Trigger an AI run. Confirm:
  - Dock background is a static darker shade (no shimmer animation).
  - Sparkle does not spin.
  - Toast / sheet still transition (those are short and informational — keeping them is acceptable; if you'd rather kill those too, gate them under the same media query).

- [ ] **Step 5: Final commit if any cleanup needed.**

  If Step 1–4 surfaced any regressions, fix them with one targeted commit per fix. If nothing broke:

  ```bash
  echo "Visual minimalism redesign complete."
  ```

---

## Self-Review Notes

- **Spec coverage check:**
  - Part 1 (Header) → Tasks 1, 2 ✓
  - Part 2 (Preferences sheet) → Task 5 ✓
  - Part 3 (AI dock + cancel) → Tasks 6, 7, 8, 9, 10, 11, 12, 13 ✓
  - Part 4 (Tabs) → Task 4 ✓
  - Part 5 (Day selector) → Task 3 ✓
  - Part 6 (Color palette discipline) → applied throughout (no dedicated task — it's a rule, not a deliverable).
- **Testing gap noted:** the spec called for component tests with Vitest + Vue Test Utils. This repo has no test framework configured (no `vitest`, no `@vue/test-utils`, no `test` script). Setting up a test framework is a separate concern outside this plan's scope. Verification is therefore manual via the dev server, with each task having a concrete browser-verification step. If you want unit tests to land alongside this work, do that as a precursor PR (add `vitest`, `@vue/test-utils`, `happy-dom`, configure `vitest.config.ts`, add a `test` script) and then add tests inline as you build the components above.
- **Status color note:** the spec example used `text-terra-600` for "Upcoming". The actual existing palette uses `text-ocean-700` for upcoming, `text-forest-700` for ongoing, `text-sand-600` for completed. Task 1's `textClass` field uses the existing colors; the header in Task 2 just calls `.textClass`. No contradiction — the spec's "e.g." was illustrative.
