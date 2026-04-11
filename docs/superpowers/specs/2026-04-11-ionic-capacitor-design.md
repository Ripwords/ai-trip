# Ionic Capacitor Mobile App Conversion

**Date:** 2026-04-11
**Branch:** `feat/ionic-capacitor`
**Approach:** Cherry-pick `@ionic/vue` components + Capacitor (Approach B)

## Goals

- Make the existing web app feel more native with selective Ionic component adoption
- Wrap the app in Capacitor for App Store / Play Store distribution
- Keep the existing SSR web app fully functional — no regressions
- Preserve the custom sand/terra design system

## Non-Goals

- Full Ionic shell / router takeover (rejected — too invasive)
- Native map rendering (deferred to Phase 2)
- Camera / photo features (future scope)

---

## Architecture Decisions

### SSR Toggle

Web deploys retain SSR. Capacitor builds use CSR.

```ts
// nuxt.config.ts
ssr: process.env.CAPACITOR ? false : true
```

### No Ionic Router

Keep Nuxt's file-based routing, `<NuxtPage>`, `useRouter()`, layouts, and middleware unchanged. Ionic components are imported individually — no `@nuxtjs/ionic` module.

### Platform Detection

A `useCapacitor()` composable exposes `isNative` and `platform` for conditional rendering:

```ts
import { Capacitor } from '@capacitor/core'

export function useCapacitor() {
  const isNative = Capacitor.isNativePlatform()
  const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web'
  return { isNative, platform }
}
```

### Mobile Entry Point

Mobile skips the landing page (`index.vue`). The auth middleware redirects authenticated users to `/dashboard`. For unauthenticated users on Capacitor, redirect `/` to `/login` in `auth.global.ts`.

### iOS Mode Globally

Force `mode: 'ios'` for visual consistency across both platforms.

---

## Theming

Map Ionic CSS variables to the existing sand/terra design tokens in `app/assets/css/ionic-theme.css`:

```css
:root {
  --ion-background-color: #faf8f5;        /* sand-50 */
  --ion-text-color: #3d3328;              /* sand-900 */
  --ion-toolbar-background: #faf8f5;      /* sand-50 */
  --ion-tab-bar-background: #faf8f5;      /* sand-50 */
  --ion-color-primary: #e85d3a;           /* terra-500 */
  --ion-color-danger: #dc2626;            /* red-600 */
  --ion-item-background: transparent;
  --ion-card-background: #f3efe8;         /* sand-100 */
  --ion-font-family: 'DM Sans', system-ui, sans-serif;
}

.dark {
  --ion-background-color: #1a1714;        /* sand-50 dark */
  --ion-text-color: #f3efe8;             /* sand-900 dark */
  --ion-toolbar-background: #1a1714;
  --ion-tab-bar-background: #1a1714;
  --ion-card-background: #23201b;         /* sand-100 dark */
}
```

Import order: Ionic CSS → Tailwind CSS (Ionic first so Tailwind can override where needed).

---

## Ionic Component Replacements

### Overlays & Feedback

| Current | Replacement | Notes |
|---|---|---|
| `ConfirmDialog.vue` + `useConfirm()` | `ion-action-sheet` | Rewrite composable to use `actionSheetController` |
| `AddActivityModal.vue` | `ion-modal` sheet (`breakpoints: [0, 0.75, 1]`) | Drag-dismissable bottom sheet |
| `EditActivityModal.vue` | `ion-modal` sheet (`breakpoints: [0, 0.75, 1]`) | Same pattern as add |
| `TripPickerModal.vue` | `ion-modal` half-sheet (`breakpoints: [0, 0.5]`) | Compact picker |
| `CountryDetailPanel.vue` | `ion-modal` sheet on mobile, sidebar on desktop | Breakpoint-based (benefits web mobile too), not platform-gated |
| No toast system | `ion-toast` via new `useToast()` composable | Replace inline success/error messages app-wide |
| `AiLoadingOverlay.vue` | **Keep as-is** | Custom branded experience, better than generic spinner |

### Lists & Items

| Current | Replacement | Notes |
|---|---|---|
| Activity cards (hover edit/delete) | `ion-item-sliding` + `ion-item-option` | Swipe to reveal edit/delete |
| Flight cards (delete button) | `ion-item-sliding` | Swipe to delete |
| `vuedraggable` reorder | `ion-reorder-group` + `ion-reorder` | With haptic feedback on drag |
| Activity log pagination buttons | `ion-infinite-scroll` | Auto-load on scroll |
| No pull-to-refresh | `ion-refresher` | Dashboard, flights, trip detail |

### Forms & Input

| Current | Replacement | Notes |
|---|---|---|
| `<input type="date">` | `ion-datetime` in `ion-modal` | Native calendar picker |
| `PlaceSearchInput.vue` | `ion-searchbar` visual wrapper | Keep existing search composable logic |
| Theme toggle buttons | `ion-segment` + `ion-segment-button` | Light / Dark / System |

### Navigation

| Current | Replacement | Notes |
|---|---|---|
| Top header nav links | Conditional: `ion-tab-bar` on mobile, keep top nav on web | Tabs: Dashboard, Explore, Flights, Settings |
| `TripDetailTabs.vue` scroll tabs | `ion-segment` | Native segmented control |
| "+ New Trip" button | `ion-fab` + `ion-fab-button` on mobile, keep inline on desktop | Floating action button |

### Unchanged Components

- `ScratchMap.vue` — SVG/d3, no Ionic equivalent
- `TripMap.vue` / `TripOverviewMap.vue` — Google Maps JS (Phase 2 for native maps)
- `AiLoadingOverlay.vue` — custom branded overlay
- `AiQuickActions.vue` — custom AI buttons
- `DaySection.vue` — complex layout, tightly coupled with drag-drop and travel segments
- All server routes — untouched
- Auth flow (Better Auth) — untouched
- Landing page (`index.vue`) — unchanged, skipped on Capacitor

---

## Capacitor Plugins

### Status Bar (`@capacitor/status-bar`)
- Sync with `useDarkMode()` — `setStyle()` and `setBackgroundColor()` reactively
- Light mode: `#faf8f5`, dark mode: `#1a1714`
- Web: meta tag fallback stays as-is

### Splash Screen (`@capacitor/splash-screen`)
- Auto-show on launch, hide after Nuxt app mounts
- Sand/terra branding, app logo
- Configure via `capacitor.config.ts`

### Keyboard (`@capacitor/keyboard`)
- `setScroll({ isDisabled: false })` — auto-scroll to focused inputs
- `setAccessoryBarHidden({ isHidden: true })` — cleaner input experience

### Haptics (`@capacitor/haptics`)
- `impact('light')` — reorder drag start/end
- `impact('medium')` — swipe-to-delete reveal
- `notification('success')` — trip created, activity added, expense saved
- `notification('warning')` — delete confirmation
- Wrapped in `useHaptics()` composable with `isNativePlatform()` guard

### Share (`@capacitor/share`)
- Native share sheet for trip sharing
- `Share.share({ title, text, url })` — replaces clipboard copy
- Web fallback: clipboard copy with toast confirmation
- Wrapped in `useNativeShare()` composable

### Browser (`@capacitor/browser`)
- `Browser.open({ url })` for external links
- Google Maps directions, booking links, activity URLs
- Opens in-app Safari (iOS) / Chrome Custom Tab (Android)

### Push Notifications (`@capacitor/push-notifications`)
- Register on first authenticated app open
- Store device token (FCM/APNs) server-side in new `device_tokens` table
- New server endpoint: `POST /api/notifications/register`
- New server utility: `server/lib/push.ts` — send push via FCM
- Dual-channel delivery: passport expiry sends email (existing) AND push notification
- Permission prompt UX: show explanation before requesting

### Local Notifications (`@capacitor/local-notifications`)
- Schedule flight departure reminders: `departure_time - 3h`
- When flight is added/updated, schedule notification on device
- When flight is deleted, cancel scheduled notification
- No server involvement — runs entirely on device
- Wrapped in `useFlightAlerts()` composable

### Geolocation (`@capacitor/geolocation`)
- "Show my location" button on trip detail map
- Shows user position relative to planned activities
- Permission requested only on button tap, not on app launch
- Could enhance explore scratch map with "you are here" marker

---

## New Files

```
capacitor.config.ts
app/assets/css/ionic-theme.css
app/composables/useCapacitor.ts
app/composables/useHaptics.ts
app/composables/useNativeShare.ts
app/composables/useToast.ts
app/composables/useAppNotifications.ts
app/composables/useFlightAlerts.ts
server/db/schema/device-tokens.ts
server/api/notifications/register.post.ts
server/lib/push.ts
ios/                                    (generated by Capacitor)
android/                                (generated by Capacitor)
```

## Modified Files

```
nuxt.config.ts                          (SSR toggle, Ionic CSS import)
package.json                            (new dependencies)
app/assets/css/tailwind.css             (Ionic CSS import order)
app/layouts/app.vue                     (conditional bottom tab bar)
app/components/ConfirmDialog.vue        (→ ion-action-sheet)
app/composables/useConfirm.ts           (rewrite for ion-action-sheet)
app/components/AddActivityModal.vue     (→ ion-modal sheet)
app/components/EditActivityModal.vue    (→ ion-modal sheet)
app/components/TripPickerModal.vue      (→ ion-modal sheet)
app/components/CountryDetailPanel.vue   (→ ion-modal on mobile)
app/components/TripDetailTabs.vue       (→ ion-segment)
app/components/ActivityCard.vue         (→ ion-item-sliding wrapper)
app/components/FlightCard.vue           (→ ion-item-sliding wrapper)
app/components/DaySection.vue           (ion-reorder-group)
app/components/TripActivityLog.vue      (→ ion-infinite-scroll)
app/pages/dashboard.vue                 (ion-refresher, ion-fab)
app/pages/flights.vue                   (ion-refresher, ion-item-sliding)
app/pages/trips/new.vue                 (ion-datetime)
app/pages/trips/[id].vue                (ion-refresher)
app/pages/settings.vue                  (ion-segment for theme)
app/pages/explore.vue                   (geolocation button)
app/plugins/dark-mode.ts                (status bar sync)
app/middleware/auth.global.ts           (Capacitor root redirect)
server/tasks/check-passport-expiry.ts   (dual-channel: email + push)
```

---

## Phase 2 (Future)

### Native Maps
- Apple MapKit on iOS, Google Maps native on Android
- `useNativeMap()` abstraction composable
- Rework `TripMap.vue`, `TripOverviewMap.vue`, potentially `ScratchMap.vue`
- Platform-branched map deep links (Apple Maps vs Google Maps URLs)

### Additional Plugins (Future)
- `@capacitor/camera` — trip photos, profile picture
- `@capacitor-community/barcode-scanner` — scan boarding passes
- `@capacitor/filesystem` — PDF export of itineraries
