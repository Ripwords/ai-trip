# Trip Detail Page — Visual Minimalism Redesign

**Date:** 2026-04-29
**Scope:** `app/pages/trips/[id].vue` and a small set of supporting components
**Constraint:** No functionality is removed. Every existing feature stays — this is a visual-weight redesign.

## Problem

The page is functionally complete but visually crowded. The current chrome competes with the actual trip content:

- The header row mixes six pills of two different kinds: **information** (`7 days`, `moderate`, `relaxed`) and **actions** (`Preferences`, `⋯`, `Share`). Mixing them flattens the visual hierarchy.
- The AI prompt area stacks four+ rows: quick-action buttons, usage counter, the bordered `BorderBeam` input, prompt suggestions, and (when present) a feedback message. All vertical, all visible at once.
- Eight tabs render as colored pills in a horizontally scrolling row, every tab fighting for attention equally.
- Day selector pills use a saturated terra-pink fill for the active day, plus a separate ring + dot indicator for "today" — three competing signals on a strip of seven items.
- The "Generate Full Itinerary" button is a separate full-width CTA that overlaps in intent with the AI prompt bar below it.
- Trip preferences open as an inline expansion panel that pushes content down, adding a third major "open/closed" state to the header region.
- Every section in the left content column (Ideas / Accommodation / Activities) wraps in a bordered white card with its own action affordances.

User-stated guiding principle: **AI features should be helpful, not annoying** — chrome that exists only to advertise AI capability should be hidden until the user signals intent.

## Goals

- Reduce visible chrome elements by roughly half, without removing any feature or making any feature harder to invoke at the moment of use.
- Separate **information** from **action** in the header so they read as different layers.
- Consolidate the multi-row AI toolbar into a single floating dock with progressive disclosure for its supporting controls.
- Make tabs and the day selector feel like a single quiet unit each, not a row of competing chips.
- Establish a default visual language: neutral chrome by default, terra accent reserved for the primary action surface (the dock send button, the active-tab underline, and the "today" text color).

## Non-goals

- Restructuring the data model, server routes, or any business logic in `app/pages/trips/[id].vue`.
- Restyling the other tab panels' interiors (`TripOverview`, `ExpenseTracker`, `ReservationTracker`, `DocumentPanel`, `TripMembers`, `TripActivityLog`, the Flights tab content) beyond what the shared header/tabs change forces. Those panels remain as-is.
- Changing the content cards (`IdeasBucket`, `AccommodationSection`, `DaySection`) — the user explicitly chose to keep them as bordered cards. Their internal styling is out of scope.
- Replacing or restyling the map (`TripMap`) or the stats footer (`TripStats`).
- A separate "read mode / edit mode" toggle (considered as an option; rejected).
- Mobile-specific reflows beyond what the existing responsive utilities already handle. Small-screen sizes inherit the desktop redesign.

---

## Part 1 — Header

### Today

Two stacked rows under the back arrow + title: a metadata caption (dates + status badge), then a wrap of six pill-buttons mixing read-only info (`7 days`, `moderate`, `relaxed`) with actions (`⚙ Preferences`, `⋯`, `🔗 Share`).

### Target

A single header row with two clearly separated halves:

**Left half — title block:**

- Back arrow `<NuxtLink to="/dashboard">` with hover background, no change.
- `<h1>` destination title — keep current font and size.
- One quiet metadata line directly under the title, all in `text-sand-500`/`text-sand-600`, separated by middle-dot dividers in `text-sand-300`. Order:
  - Date range (`May 14 – 21, 2026`)
  - Day count (`7 days`)
  - Status badge text — same `getTripStatus` label, but rendered as inline text in the badge's color (e.g. `text-terra-600` for "Upcoming"), **without** the rounded-pill background.
  - Budget preference (capitalized, e.g. `moderate`) — only if set.
  - Pace preference (capitalized, e.g. `relaxed`) — only if set.

**Right half — action icons:**

Three icon-only buttons, 34px square, neutral background, hover-revealed `bg-sand-100`. Tooltips via `title=` attributes:

1. `⚙` — Preferences. Opens the new preferences sheet (Part 2).
2. `🔗` / `✓` (when copied) — Share. Wraps the existing `handleToggleShare` / `handleCopyShareLink` flow. When no share token exists yet, tapping calls `handleToggleShare` (generates + copies). When a share token already exists, tapping opens a small popover anchored to the icon with two items: `Copy link` (calls `handleCopyShareLink`) and `Revoke` (calls `handleToggleShare`). Show a `lucide:check` icon for 2s after a copy. Owners only — hidden for non-owner roles.
3. `⋯` — More menu. Same dropdown contents as today: `Edit trip` (owners only), `Export KML`, `Export PDF`. Click-outside dismiss behavior unchanged.

The viewer-role rules from today are preserved: viewers don't see `⚙` (preferences are owner-edited), don't see the "Edit trip" item, and don't see the share icon.

### Files

- `app/pages/trips/[id].vue` — replace the existing header block (`<!-- Header -->` through the closing `</div>` before `<!-- Preferences editor -->`).

### Specifics

- Status text color uses a new `getTripStatus(...).textClass` field. Add `textClass` to the existing util (likely in `app/utils/trip-status.ts` or wherever `getTripStatus` is defined). Each status branch returns the foreground class only (e.g. `text-terra-600` for upcoming), no background. The header renders status as plain text styled with `textClass`. Existing `badgeClass` callers are not touched.
- The `BorderBeam` import is not needed for the header itself — it lives on the AI dock (see Part 3).
- The "More menu" Transition wrapper and click-outside listener stay as-is.

---

## Part 2 — Preferences slide-up sheet

### Today

Toggling `showPrefsEditor` renders an inline `<div>` between the header and tabs that pushes everything below it down. Contains four fields: Budget, Pace, Currency, Interests.

### Target

Replace the inline panel with a slide-up sheet — a bottom sheet on small screens, a right-side drawer on `lg:` and up. Same four fields, same change handlers (`updatePreference`, `handleCurrencyChange`).

### Implementation

Create `app/components/TripPreferencesSheet.vue`:

```vue
<script setup lang="ts">
import type { TripResponse } from "~/types/trip"

const props = defineProps<{
  open: boolean
  trip: TripResponse
  currencyConverting: boolean
}>()

const emit = defineEmits<{
  close: []
  updatePreference: [key: string, value: string | string[]]
  changeCurrency: [newCurrency: string]
}>()
</script>
```

The sheet renders only when `open` is true. Use a backdrop element on small screens (`<lg`) to dismiss on tap; on desktop the sheet slides in from the right and ESC closes it. No backdrop dim on desktop — the sheet itself sits above content.

Animation: Vue `<Transition>` with these classes:

- Mobile: enter-from `translate-y-full`, enter-to `translate-y-0`, leave reverses. 200ms ease-out.
- Desktop: enter-from `translate-x-full`, enter-to `translate-x-0`, leave reverses. Same timing.

Pick the orientation off a `useMediaQuery('(min-width: 1024px)')` ref or simply two responsive Transition components — the simpler path is one outer container with both translate utilities applied conditionally via `lg:` prefix.

The four fields use the existing `updatePreference` / `handleCurrencyChange` paths verbatim. No business logic moves — only the wrapper.

### Files

- New: `app/components/TripPreferencesSheet.vue`
- Modify: `app/pages/trips/[id].vue` — remove the inline preferences `<div>` block (current lines ~879–962), replace with `<TripPreferencesSheet :open="showPrefsEditor" :trip="trip" :currency-converting="currencyConverting" @close="showPrefsEditor = false" @update-preference="updatePreference" @change-currency="handleCurrencyChange" />`. The `showPrefsEditor` ref's role is unchanged.

---

## Part 3 — Floating AI dock

This is the largest visual change. Today the AI controls span four to six vertical rows: quick-action buttons, usage counter, BorderBeam-wrapped input + send button, prompt suggestions, and conditionally a success/error message and a separate "Generate Full Itinerary" CTA. All of that consolidates into one floating pill at the bottom of the viewport with a single "above the dock" reveal zone.

### Visual specification

**Resting state (idle):**

- A horizontal pill, fixed-positioned at the bottom of the viewport, centered horizontally.
- Background `bg-sand-900` (or a near-black like `#1c1a14`), text white.
- Padding: `py-2 pl-4 pr-2` desktop, slightly tighter on mobile.
- Width: `w-full max-w-[480px]` on desktop, edge-to-edge minus 16px on mobile.
- Box shadow: `0 12px 28px -8px rgba(28,26,20,.5)` for visual lift.
- Z-index above page content but below modals.
- Stays within the itinerary tab's layout context (only renders when `activeTab === 'itinerary'`); other tabs do not show the dock.

**Pill contents, left to right:**

1. Sparkle icon `✦` (or `lucide:sparkles`) in `text-sand-300` / `text-terra-300`.
2. Text input — borderless, transparent background, `text-white placeholder:text-white/55`, auto-grows to fill available width.
3. Tiny usage counter `12/100` — `text-[10px] tabular-nums text-white/40`. When `aiUsage.remaining <= 10`, color shifts to `text-terra-300 font-medium`. When `<= 0`, the input becomes disabled with the existing "Limit reached" placeholder.
4. Send button — 32×32 circle, `bg-terra-500`, white `lucide:arrow-up` icon. When `aiLoading`, swaps to a `lucide:x` icon for cancel (cancel reuses an `AbortController` on the existing `$fetch` call — see "Cancel during AI run" below).

The `BorderBeam` component from `vue-border-beam` continues to wrap the dock pill itself for the brand glow effect — moved from wrapping the old input into wrapping the new dock. Keep its `color-variant="sunset"` props.

**The "above the dock" reveal zone:**

A single horizontally-centered region directly above the dock (about 60px above the dock's top edge). At any one time it shows zero or one of the following — never multiple stacked:

- **Empty:** when the input is not focused and there is no recent feedback message.
- **Quick action chips:** appear when the input gains focus *or* the dock is hovered (whichever first). Three white-on-light chips — `Fill gaps`, `Optimize route`, `Generate full itinerary`. Each chip is a button that triggers the existing `submitAiPrompt` path with a canned prompt (matching today's `AiQuickActions` component). The "Generate full itinerary" chip routes through the existing `GenerateFullItineraryButton` logic, calling the same backend endpoint — the chip is a thin wrapper that emits a `generate-full` event the page handles.
- **Suggestion chips:** appear when the input is focused, empty, and has been empty for ~600ms (debounce so the suggestions don't flicker on every keystroke). Two to three destination-specific suggestion chips supplied by the existing `AiPromptSuggestions` component (refactored to emit chips into a slot, not render its own row). Tapping a chip populates the input — does not submit. As soon as the input has any content, suggestions are removed.
- **Feedback toast:** appears for 6 seconds after a successful AI run. Dark green pill (`bg-forest-700`) with check icon, the AI message text, an "Undo" link (when `undoAvailable`), and an `✕` to dismiss. Auto-dismisses after 6s. Only one toast at a time. Errors show in the same slot but with a terra-red palette.

The reveal zone's position is `absolute`/`-top-N` relative to the dock. It does not push the dock itself.

**Loading state:**

- The dock background shimmers: a left-to-right linear gradient animation (`bg-size: 200% 100%`, `animate-shimmer` 2s ease infinite). Respect `prefers-reduced-motion` — fall back to a static slightly lighter background.
- The sparkle `✦` rotates slowly (`animate-spin` ~2s linear infinite, also gated by reduced-motion).
- Placeholder text swaps to a verb-driven status string keyed by `aiLoadingMode`: `Optimizing route…`, `Generating activities…`, `Removing stops…`, `Rescheduling…`. Reuse the existing `aiLoadingMode` ref and prompt-keyword detection logic.
- Send button becomes a stop ✕. Tapping it calls `controller.abort()` on the in-flight `$fetch`. The current page does not yet expose an abort controller — see Part 3.5 below.

**Mobile considerations:**

- The dock translates upward by the keyboard inset on iOS Safari when focused. Use `env(safe-area-inset-bottom)` for resting padding.
- On small screens the reveal zone wraps chips onto multiple rows.
- The dock's max width on mobile is the viewport minus 16px gutter. It feels closer to a full-width bar but retains the rounded-pill silhouette.

### Behavioral specification

| State | Trigger | Above-dock content |
|---|---|---|
| Idle | Page load, no focus | Nothing |
| Hover (desktop) | Pointer enters dock | Quick action chips |
| Focused, empty, immediate | Click input | Quick action chips |
| Focused, empty, 600ms | Click input + wait | Suggestion chips replace quick actions |
| Focused, typing | User typed any char | Reveal zone empty |
| Submitting | Send tapped, AI running | Reveal zone empty + dock shimmers |
| Just succeeded | AI returned with message | Feedback toast (6s) |
| Just failed | AI returned with error | Error toast (sticky until ✕) |

When the user dismisses a feedback toast manually, it does not reappear for that AI run. Closing the toast also clears `aiMessage` / `lastSnapshot` (matching today's behavior in the existing message-close button).

### Where the existing UI bits go

| Today's element | New home |
|---|---|
| `AiQuickActions` (Fill gaps / Optimize route) | Reveal-zone chips, called from same emit handlers |
| Usage counter `12/100` | Inside the dock as `text-white/40` |
| `BorderBeam`-wrapped input + arrow-up | Becomes the dock itself |
| `AiPromptSuggestions` row | Reveal-zone chips on empty-focus |
| Success message div with check + undo + ✕ | Reveal-zone success toast |
| Error message div | Reveal-zone error toast (sticky) |
| Full-page `AiLoadingOverlay` | **Removed** in favor of dock shimmer |
| `GenerateFullItineraryButton` separate CTA | **Removed** standalone, becomes the third quick-action chip |

### Cancel during AI run (Part 3.5)

`submitAiPrompt` currently has no cancellation path. Add an `aiAbortController` ref:

```ts
const aiAbortController = ref<AbortController | null>(null)
```

Inside `submitAiPrompt`, before the `$fetch` call:

```ts
aiAbortController.value = new AbortController()
const result = await $fetch(`/api/trips/${tripId}/days/${activeDayId.value}/ai`, {
  method: "POST",
  body: { prompt },
  signal: aiAbortController.value.signal,
})
```

Add `handleAiCancel` triggered by the dock's stop button:

```ts
function handleAiCancel() {
  aiAbortController.value?.abort()
  aiLoading.value = false
  aiAbortController.value = null
}
```

Catch the `AbortError` in the existing try/catch and clear `lastSnapshot` (no message, no error toast — silent cancel).

### Files

- New: `app/components/AiDock.vue` — owns the dock, the input, the reveal zone, all four states.
- Modify: `app/components/AiQuickActions.vue` — `AiDock` renders chips directly using the same canned-prompt strings. Delete `AiQuickActions.vue` after the dock takes over.
- Modify: `app/components/AiPromptSuggestions.vue` — extract the destination-aware suggestion-generation logic into a composable `useAiPromptSuggestions(destination, hasActivities)` that returns a `Ref<string[]>`. The dock consumes the ref and renders chips. Delete `AiPromptSuggestions.vue` after the composable is in place.
- Delete: `app/components/AiLoadingOverlay.vue` — removed. The dock shimmer replaces it for both single-day prompts and full-itinerary generation.
- Modify: `app/components/GenerateFullItineraryButton.vue` — extract its run logic into a composable `useGenerateFullItinerary(tripId)` that exposes `{ run(days), running }`. The "Generate full itinerary" chip in the dock calls `run(sortedDays.value)`. Delete the standalone button component after the composable is in place.
- Modify: `app/pages/trips/[id].vue` — remove the existing AI block (lines ~1033–1150 in the current file: the quick-actions row, the BorderBeam input form, the prompt suggestions, the success/error message divs) and the standalone `GenerateFullItineraryButton`. Replace with a single `<AiDock />` component bound to the same refs and handlers.

---

## Part 4 — Tabs

### Today

`TripDetailTabs` (`app/components/TripDetailTabs.vue` — assumed; the page just binds `<TripDetailTabs v-model="activeTab" />`) renders all eight tabs as horizontally scrolling colored pills.

### Target

Underline-style tabs with a "More" overflow:

- Five visible tabs: `Itinerary`, `Overview`, `Expenses`, `Bookings` (the existing `reservations` tab, renamed in display only — backing value stays `"reservations"`), and `More ▾`.
- The "More" item is a click-toggled dropdown listing: `Notes`, `Documents`, `Team`, `Flights`. Clicking an overflow tab activates it and the parent "More" tab keeps a small underline accent so the user knows their selection lives inside.
- Active tab style: black text, 500-weight, 2px terra underline directly on the bottom border of the tab strip. Inactive: `text-sand-500`, no underline, hover `text-sand-700`.
- The whole tab strip sits on a single 1px `border-b border-sand-200` so the underline accent feels like a continuation of that border.

Display-name mapping (preserve all backing TabValue strings unchanged):

| Backing value | Display label |
|---|---|
| `itinerary` | Itinerary |
| `overview` | Overview |
| `expenses` | Expenses |
| `reservations` | Bookings |
| `notes` | Notes (in More) |
| `documents` | Documents (in More) |
| `team` | Team (in More) |
| `flights` | Flights (in More) |

### Files

- Modify: `app/components/TripDetailTabs.vue` — restructure the template to render the underline + overflow pattern. Keep the same v-model contract (TabValue string in, TabValue string out). The `validTabs` array and sessionStorage restore logic in the page stay unchanged.

---

## Part 5 — Day selector

### Today

Pill-row inside a horizontal scroll container, at the top of the itinerary tab. Active day uses `bg-terra-500 text-white`. "Today" uses a separate `bg-terra-50 ring-1 ring-terra-300` style plus a tiny terra dot.

### Target

Compact numeric tiles, single neutral row:

- Each day is a vertical stack: large day number on top, three-letter weekday abbreviation below in smaller text.
- 44px minimum width per tile, 8px horizontal padding, 10px border radius.
- Inactive: `text-sand-600` on transparent background. Hover: `bg-sand-100`.
- Active: `bg-sand-900 text-white` (matches the dock's dark color — visual rhyme with the hero action surface).
- "Today" (when not active): `text-terra-600` text color only — no separate ring or dot. The terra color tells you "this is today" at a glance.
- "Today + active": `bg-sand-900 text-white` (the active state wins; the user is looking at today, no extra signal needed).
- Container: horizontal flex, 4px gap, scrollable on overflow with `scrollbar-thin`.

### Files

- Modify: `app/pages/trips/[id].vue` — replace the existing day-tab block (current lines ~985–1014). The date-formatting and `activeDayId` binding logic stays; only the markup and classes change.

---

## Part 6 — Color palette discipline

A summary of where chrome color lives in the redesign. This is the rule of thumb for any future tweaks.

| Surface | Color |
|---|---|
| Body text | `text-sand-900` |
| Secondary text, metadata, dividers | `text-sand-500` / `text-sand-300` |
| Quiet backgrounds (hover states, segment containers) | `bg-sand-100` |
| Card borders | `border-sand-200` |
| Page background | unchanged |
| **Active tab underline** | `bg-terra-500` |
| **Active day tile** | `bg-sand-900` |
| **AI dock background** | `bg-sand-900` |
| **AI dock send button** | `bg-terra-500` |
| **Status text in header** | `text-terra-600` (or matching `getTripStatus.textClass`) |
| **Today's day text (when not active)** | `text-terra-600` |
| **Low-usage warning** | `text-terra-300` (in dock) / `text-terra-500` (elsewhere) |
| Success toast | existing forest palette |
| Error toast | existing terra palette |

Terra accent is rationed: used only where the user's attention should land — the primary action button, the active selection, and the "today" signal. Everywhere else, `sand` neutrals.

---

## Implementation order

Build in this sequence so each step is independently shippable:

1. **Header restyling** (Part 1) — pure markup/CSS change in `[id].vue`. Add `getTripStatus.textClass` if needed. No new components.
2. **Day selector restyling** (Part 5) — pure markup/CSS in `[id].vue`.
3. **Tabs restyling** (Part 4) — modify `TripDetailTabs.vue`. v-model contract unchanged.
4. **Preferences sheet** (Part 2) — extract inline preferences into `TripPreferencesSheet.vue`. Wire the ⚙ icon button to it.
5. **AI dock** (Part 3) — the meatiest step. Build `AiDock.vue` with all four reveal-zone states and the cancel path. Refactor `AiQuickActions`, `AiPromptSuggestions`, and `GenerateFullItineraryButton` to expose their data/handlers in a way the dock can consume. Remove `AiLoadingOverlay`. Replace the AI block in `[id].vue` with `<AiDock />`.
6. **Cleanup** — drop unused imports, delete deprecated overlay component, verify viewer-role gating still works for the new icon buttons.

Each step ends with the page rendering correctly with the new piece swapped in.

## Testing

Per the project's TDD convention:

- Component tests (Vitest + Vue Test Utils) for `AiDock` covering each reveal-zone state transition (idle → focused → typing → submitting → success-toast → dismissed).
- Component test for `TripPreferencesSheet` open/close transition and that each field emits the expected `update-preference` payload.
- Component test for `TripDetailTabs` covering the More-overflow dropdown — clicking a tab inside the dropdown emits the correct backing value and the More button shows an active accent.
- Manual verification on the running dev server for: the dock shimmer respecting `prefers-reduced-motion`, the share icon flow (generate / copy / revoke), keyboard inset behavior on iOS Safari, viewer-role hiding the right icons.

No new server-side tests required — server contracts are unchanged.
