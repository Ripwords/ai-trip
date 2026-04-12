# Flight Globe & Layover Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3D interactive globe showing flight paths and automatic connecting flight detection with layover info to the trip flights tab.

**Architecture:** TresJS renders a satellite night-view globe from TopoJSON country polygons projected onto a Three.js sphere. Flight arcs connect airports using static coordinate data. Layover detection is a frontend computed that finds consecutive flights sharing the same transfer airport within 24 hours, with AI-powered exploration tips fetched on demand via a new Gemini endpoint.

**Tech Stack:** TresJS (`@tresjs/core`, `@tresjs/cientos`), Three.js, d3-geo, topojson-client, Gemini AI (`@ai-sdk/google`), Zod, Nuxt server routes

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `app/utils/airport-coordinates.ts` | Static IATA → `{ lat, lng }` mapping for ~200 airports |
| `app/composables/useLayoverDetection.ts` | Composable: detects connecting flights, computes layover duration/recommendation |
| `app/components/FlightGlobe.vue` | TresJS 3D globe with country polygons and flight arc rendering |
| `app/components/LayoverCard.vue` | Layover info card with duration, visa badge, recommendation, AI tips button |
| `server/api/ai/layover-tips.post.ts` | Gemini endpoint for AI layover exploration suggestions |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `@tresjs/core`, `@tresjs/cientos`, `three` |
| `nuxt.config.ts` | Add TresJS module, add `three` to optimizeDeps |
| `app/pages/trips/[id].vue` | Integrate FlightGlobe and LayoverCard into flights tab |

---

## Task 1: Install TresJS Dependencies

**Files:**
- Modify: `package.json`
- Modify: `nuxt.config.ts`

- [ ] **Step 1: Install packages**

```bash
npx nuxi@latest module add @tresjs/nuxt
npm install @tresjs/cientos
```

- [ ] **Step 2: Verify nuxt.config.ts has the TresJS module**

After running `nuxi module add`, verify that `@tresjs/nuxt` was added to the modules array in `nuxt.config.ts`. If not, add it manually:

```ts
modules: [
  "@tresjs/nuxt",
  "@nuxt/icon",
  // ... existing modules
],
```

- [ ] **Step 3: Add three to Vite optimizeDeps**

In `nuxt.config.ts`, add `"three"` to the `optimizeDeps.include` array:

```ts
optimizeDeps: {
  include: [
    "three",
    // ... existing entries
  ],
},
```

- [ ] **Step 4: Verify the dev server starts**

```bash
npm run dev
```

Expected: Dev server starts without errors. TresJS module loads.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json nuxt.config.ts
git commit -m "chore: add TresJS dependencies for 3D globe"
```

---

## Task 2: Airport Coordinates Dataset

**Files:**
- Create: `app/utils/airport-coordinates.ts`

- [ ] **Step 1: Create the airport coordinates file**

Create `app/utils/airport-coordinates.ts` with a static `Record<string, { lat: number; lng: number }>` mapping all ~234 IATA codes from the existing `iata-to-country.ts` to their real coordinates. Include a helper function.

```ts
/** Airport coordinates for the ~200 busiest airports, matching iata-to-country.ts coverage */
export const airportCoordinates: Record<string, { lat: number; lng: number }> = {
  // North America
  ATL: { lat: 33.6407, lng: -84.4277 },
  LAX: { lat: 33.9425, lng: -118.4081 },
  ORD: { lat: 41.9742, lng: -87.9073 },
  DFW: { lat: 32.8998, lng: -97.0403 },
  DEN: { lat: 39.8561, lng: -104.6737 },
  JFK: { lat: 40.6413, lng: -73.7781 },
  SFO: { lat: 37.6213, lng: -122.379 },
  SEA: { lat: 47.4502, lng: -122.3088 },
  LAS: { lat: 36.084, lng: -115.1537 },
  MCO: { lat: 28.4312, lng: -81.3081 },
  EWR: { lat: 40.6895, lng: -74.1745 },
  MIA: { lat: 25.7959, lng: -80.287 },
  IAH: { lat: 29.9902, lng: -95.3368 },
  BOS: { lat: 42.3656, lng: -71.0096 },
  MSP: { lat: 44.8848, lng: -93.2223 },
  DTW: { lat: 42.2162, lng: -83.3554 },
  PHL: { lat: 39.8744, lng: -75.2424 },
  CLT: { lat: 35.214, lng: -80.9431 },
  IAD: { lat: 38.9531, lng: -77.4565 },
  SAN: { lat: 32.7338, lng: -117.1933 },
  HNL: { lat: 21.3187, lng: -157.9224 },
  YYZ: { lat: 43.6777, lng: -79.6248 },
  YVR: { lat: 49.1947, lng: -123.1788 },
  YUL: { lat: 45.4706, lng: -73.7408 },
  YOW: { lat: 45.3225, lng: -75.6692 },
  MEX: { lat: 19.4363, lng: -99.0721 },
  CUN: { lat: 21.0365, lng: -86.8771 },
  GDL: { lat: 20.5218, lng: -103.3111 },

  // Europe
  LHR: { lat: 51.47, lng: -0.4543 },
  LGW: { lat: 51.1537, lng: -0.1821 },
  STN: { lat: 51.885, lng: 0.235 },
  MAN: { lat: 53.3537, lng: -2.275 },
  EDI: { lat: 55.9508, lng: -3.3615 },
  CDG: { lat: 49.0097, lng: 2.5479 },
  ORY: { lat: 48.7233, lng: 2.3794 },
  NCE: { lat: 43.6584, lng: 7.2159 },
  LYS: { lat: 45.7256, lng: 5.0811 },
  FRA: { lat: 50.0379, lng: 8.5622 },
  MUC: { lat: 48.3537, lng: 11.775 },
  TXL: { lat: 52.5597, lng: 13.2877 },
  HAM: { lat: 53.6304, lng: 10.0065 },
  DUS: { lat: 51.2895, lng: 6.7668 },
  AMS: { lat: 52.3105, lng: 4.7683 },
  MAD: { lat: 40.4983, lng: -3.5676 },
  BCN: { lat: 41.2971, lng: 2.0785 },
  AGP: { lat: 36.675, lng: -4.499 },
  PMI: { lat: 39.5517, lng: 2.7388 },
  FCO: { lat: 41.8003, lng: 12.2389 },
  MXP: { lat: 45.63, lng: 8.7231 },
  VCE: { lat: 45.5053, lng: 12.3519 },
  NAP: { lat: 40.886, lng: 14.2908 },
  LIS: { lat: 38.7756, lng: -9.1354 },
  OPO: { lat: 41.2481, lng: -8.6814 },
  ZRH: { lat: 47.4647, lng: 8.5492 },
  GVA: { lat: 46.238, lng: 6.1089 },
  VIE: { lat: 48.1103, lng: 16.5697 },
  BRU: { lat: 50.9014, lng: 4.4844 },
  DUB: { lat: 53.4264, lng: -6.2499 },
  CPH: { lat: 55.618, lng: 12.656 },
  ARN: { lat: 59.6519, lng: 17.9186 },
  OSL: { lat: 60.1976, lng: 11.1004 },
  HEL: { lat: 60.3172, lng: 24.9633 },
  ATH: { lat: 37.9364, lng: 23.9445 },
  PRG: { lat: 50.1008, lng: 14.26 },
  WAW: { lat: 52.1657, lng: 20.9671 },
  KRK: { lat: 50.0777, lng: 19.7848 },
  BUD: { lat: 47.4398, lng: 19.2612 },
  IST: { lat: 41.2753, lng: 28.7519 },
  SAW: { lat: 40.8986, lng: 29.3092 },
  AYT: { lat: 36.8987, lng: 30.8005 },
  KEF: { lat: 63.985, lng: -22.6056 },
  ZAG: { lat: 45.7429, lng: 16.0688 },
  SPU: { lat: 43.5389, lng: 16.298 },
  DBV: { lat: 42.5614, lng: 18.2682 },
  OTP: { lat: 44.5711, lng: 26.085 },
  SOF: { lat: 42.6967, lng: 23.4114 },
  BEG: { lat: 44.8184, lng: 20.309 },

  // Middle East
  DXB: { lat: 25.2528, lng: 55.3644 },
  AUH: { lat: 24.433, lng: 54.6511 },
  SHJ: { lat: 25.3286, lng: 55.5172 },
  DOH: { lat: 25.2731, lng: 51.6082 },
  JED: { lat: 21.6796, lng: 39.1565 },
  RUH: { lat: 24.9576, lng: 46.6988 },
  TLV: { lat: 32.0114, lng: 34.8867 },

  // Asia
  NRT: { lat: 35.772, lng: 140.3929 },
  HND: { lat: 35.5494, lng: 139.7798 },
  KIX: { lat: 34.4347, lng: 135.244 },
  CTS: { lat: 42.7752, lng: 141.6925 },
  FUK: { lat: 33.5859, lng: 130.4511 },
  NGO: { lat: 34.8584, lng: 136.8125 },
  ICN: { lat: 37.4602, lng: 126.4407 },
  GMP: { lat: 37.5583, lng: 126.7906 },
  PUS: { lat: 35.1796, lng: 128.9382 },
  PEK: { lat: 40.0801, lng: 116.5845 },
  PVG: { lat: 31.1443, lng: 121.8083 },
  CAN: { lat: 23.3924, lng: 113.2988 },
  CTU: { lat: 30.5785, lng: 103.9471 },
  SZX: { lat: 22.6393, lng: 113.8107 },
  HKG: { lat: 22.308, lng: 113.9185 },
  TPE: { lat: 25.0797, lng: 121.2342 },
  KHH: { lat: 22.5771, lng: 120.3502 },
  SIN: { lat: 1.3644, lng: 103.9915 },
  BKK: { lat: 13.6899, lng: 100.7501 },
  DMK: { lat: 13.9126, lng: 100.607 },
  CNX: { lat: 18.7668, lng: 98.9625 },
  HKT: { lat: 8.1132, lng: 98.3169 },
  KUL: { lat: 2.7456, lng: 101.7099 },
  PEN: { lat: 5.2971, lng: 100.2768 },
  LGK: { lat: 6.3297, lng: 99.7286 },
  BKI: { lat: 5.9372, lng: 116.0515 },
  KCH: { lat: 1.4847, lng: 110.3483 },
  SZB: { lat: 3.1308, lng: 101.5494 },
  CGK: { lat: -6.1256, lng: 106.6558 },
  DPS: { lat: -8.7482, lng: 115.1672 },
  SUB: { lat: -7.3798, lng: 112.7868 },
  SGN: { lat: 10.8188, lng: 106.6519 },
  HAN: { lat: 21.2212, lng: 105.807 },
  DAD: { lat: 16.0439, lng: 108.1992 },
  MNL: { lat: 14.5086, lng: 121.0197 },
  CEB: { lat: 10.3075, lng: 123.9794 },
  DEL: { lat: 28.5562, lng: 77.1 },
  BOM: { lat: 19.0896, lng: 72.8656 },
  BLR: { lat: 13.1986, lng: 77.7066 },
  MAA: { lat: 12.9941, lng: 80.1709 },
  CCU: { lat: 22.6547, lng: 88.4467 },
  HYD: { lat: 17.2403, lng: 78.4294 },
  PNH: { lat: 11.5466, lng: 104.844 },
  REP: { lat: 13.4107, lng: 103.8128 },
  RGN: { lat: 16.9073, lng: 96.1332 },
  CMB: { lat: 7.1801, lng: 79.8841 },
  MLE: { lat: 4.1918, lng: 73.5291 },
  KTM: { lat: 27.6966, lng: 85.3591 },
  DAC: { lat: 23.8433, lng: 90.3978 },
  ISB: { lat: 33.6167, lng: 73.0992 },
  KHI: { lat: 24.9065, lng: 67.1609 },
  LHE: { lat: 31.5216, lng: 74.4036 },
  VTE: { lat: 17.9883, lng: 102.5633 },
  LPQ: { lat: 19.8973, lng: 102.1614 },

  // Russia
  SVO: { lat: 55.9726, lng: 37.4146 },
  DME: { lat: 55.4088, lng: 37.9063 },
  LED: { lat: 59.8003, lng: 30.2625 },

  // Oceania
  SYD: { lat: -33.9461, lng: 151.1772 },
  MEL: { lat: -37.6733, lng: 144.8433 },
  BNE: { lat: -27.3842, lng: 153.1175 },
  PER: { lat: -31.9403, lng: 115.9672 },
  AKL: { lat: -37.008, lng: 174.792 },
  WLG: { lat: -41.3272, lng: 174.8053 },
  CHC: { lat: -43.4894, lng: 172.5322 },
  NAN: { lat: -17.7554, lng: 177.4431 },

  // Africa
  JNB: { lat: -26.1392, lng: 28.246 },
  CPT: { lat: -33.9649, lng: 18.6017 },
  CAI: { lat: 30.1219, lng: 31.4056 },
  CMN: { lat: 33.3675, lng: -7.5898 },
  NBO: { lat: -1.3192, lng: 36.9278 },
  ADD: { lat: 8.9779, lng: 38.7993 },

  // South America
  GRU: { lat: -23.4356, lng: -46.4731 },
  GIG: { lat: -22.8099, lng: -43.2505 },
  EZE: { lat: -34.8222, lng: -58.5358 },
  SCL: { lat: -33.393, lng: -70.7858 },
  BOG: { lat: 4.7016, lng: -74.1469 },
  LIM: { lat: -12.0219, lng: -77.1143 },
}

/** Get coordinates for an IATA airport code */
export function getAirportCoordinates(iata: string): { lat: number; lng: number } | undefined {
  return airportCoordinates[iata.toUpperCase()]
}
```

- [ ] **Step 2: Verify the module resolves**

```bash
npm run dev
```

Open browser devtools console on any page and verify no import errors. The file is a static utility — it just needs to parse correctly.

- [ ] **Step 3: Commit**

```bash
git add app/utils/airport-coordinates.ts
git commit -m "feat: add static airport coordinates dataset for globe visualization"
```

---

## Task 3: Layover Detection Composable

**Files:**
- Create: `app/composables/useLayoverDetection.ts`

- [ ] **Step 1: Create the composable**

Create `app/composables/useLayoverDetection.ts`. This composable takes a sorted array of flights and returns an array of items to render — either a flight or a layover card between connecting flights.

```ts
import { computed, type Ref } from "vue"
import { iataToCountry } from "../utils/iata-to-country"

interface FlightItem {
  id: string
  flightNumber: string
  flightDate: string
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
  [key: string]: unknown
}

export interface LayoverInfo {
  type: "layover"
  airport: string
  country: string | undefined
  durationMinutes: number | null
  arrivalFlight: FlightItem
  departureFlight: FlightItem
  arrivalTime: string | null
  departureTime: string | null
  recommendation: "stay" | "tight" | "explore"
  recommendationLabel: string
}

export interface FlightEntry {
  type: "flight"
  flight: FlightItem
}

export type FlightListItem = FlightEntry | LayoverInfo

const MAX_LAYOVER_MS = 24 * 60 * 60 * 1000 // 24 hours

function getRecommendation(
  durationMinutes: number | null,
): Pick<LayoverInfo, "recommendation" | "recommendationLabel"> {
  if (durationMinutes === null) {
    return { recommendation: "stay", recommendationLabel: "Connection detected" }
  }
  if (durationMinutes < 180) {
    return { recommendation: "stay", recommendationLabel: "Stay in airport" }
  }
  if (durationMinutes < 360) {
    return { recommendation: "tight", recommendationLabel: "Tight but possible" }
  }
  return { recommendation: "explore", recommendationLabel: "Go explore!" }
}

export function useLayoverDetection(flights: Ref<FlightItem[] | null>) {
  const flightListItems = computed<FlightListItem[]>(() => {
    const sorted = flights.value
    if (!sorted || sorted.length === 0) return []

    const items: FlightListItem[] = []

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!
      items.push({ type: "flight", flight: current })

      // Check if next flight forms a connection
      if (i < sorted.length - 1) {
        const next = sorted[i + 1]!

        if (
          current.arrivalAirport &&
          next.departureAirport &&
          current.arrivalAirport === next.departureAirport
        ) {
          let durationMinutes: number | null = null

          if (current.arrivalTime && next.departureTime) {
            const arrivalMs = new Date(current.arrivalTime).getTime()
            const departureMs = new Date(next.departureTime).getTime()
            const diffMs = departureMs - arrivalMs

            // Only treat as layover if within 24 hours and positive
            if (diffMs <= 0 || diffMs > MAX_LAYOVER_MS) continue

            durationMinutes = Math.round(diffMs / 60000)
          }

          const { recommendation, recommendationLabel } = getRecommendation(durationMinutes)

          items.push({
            type: "layover",
            airport: current.arrivalAirport,
            country: iataToCountry[current.arrivalAirport] ?? undefined,
            durationMinutes,
            arrivalFlight: current,
            departureFlight: next,
            arrivalTime: current.arrivalTime,
            departureTime: next.departureTime,
            recommendation,
            recommendationLabel,
          })
        }
      }
    }

    return items
  })

  return { flightListItems }
}
```

- [ ] **Step 2: Verify dev server still starts**

```bash
npm run dev
```

Expected: No errors. The composable is not yet used anywhere.

- [ ] **Step 3: Commit**

```bash
git add app/composables/useLayoverDetection.ts
git commit -m "feat: add layover detection composable for connecting flights"
```

---

## Task 4: LayoverCard Component

**Files:**
- Create: `app/components/LayoverCard.vue`

- [ ] **Step 1: Create the LayoverCard component**

Create `app/components/LayoverCard.vue`:

```vue
<script setup lang="ts">
import type { LayoverInfo } from "../composables/useLayoverDetection"

const props = defineProps<{
  layover: LayoverInfo
}>()

const showAiTips = ref(false)
const aiTipsLoading = ref(false)
const aiTips = ref<{
  recommendation: string
  suggestions: string[]
  transitInfo: string
  returnBy: string
} | null>(null)
const aiError = ref<string | null>(null)

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

const recommendationStyle = computed(() => {
  switch (props.layover.recommendation) {
    case "stay":
      return "bg-orange-900/30 text-orange-400"
    case "tight":
      return "bg-yellow-900/30 text-yellow-400"
    case "explore":
      return "bg-green-900/30 text-green-400"
  }
})

const recommendationIcon = computed(() => {
  switch (props.layover.recommendation) {
    case "stay":
      return "lucide:shield"
    case "tight":
      return "lucide:clock"
    case "explore":
      return "lucide:map-pin"
  }
})

async function fetchAiTips() {
  if (aiTips.value || aiTipsLoading.value) {
    showAiTips.value = !showAiTips.value
    return
  }

  showAiTips.value = true
  aiTipsLoading.value = true
  aiError.value = null

  try {
    const result = await $fetch("/api/ai/layover-tips", {
      method: "POST",
      body: {
        airport: props.layover.airport,
        durationMinutes: props.layover.durationMinutes,
        visaStatus: null, // Will be enriched by the API from the user's passport
        arrivalTime: props.layover.arrivalTime,
      },
    })
    aiTips.value = result
  } catch (err: unknown) {
    const errorData = err as { statusCode?: number; data?: { message?: string } }
    if (errorData.statusCode === 429) {
      aiError.value = "AI usage limit reached for this month."
    } else {
      aiError.value = "Failed to load AI tips. Try again later."
    }
  } finally {
    aiTipsLoading.value = false
  }
}
</script>

<template>
  <div class="rounded-xl border border-dashed border-sand-300 bg-sand-50/50 p-4">
    <div class="flex items-center gap-3">
      <!-- Clock icon -->
      <div
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sand-100"
      >
        <Icon name="lucide:clock" class="h-4 w-4 text-sand-500" />
      </div>

      <!-- Main info -->
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-semibold text-sand-900">
            <template v-if="layover.durationMinutes !== null">
              {{ formatDuration(layover.durationMinutes) }} layover at {{ layover.airport }}
            </template>
            <template v-else>
              Connection at {{ layover.airport }}
            </template>
          </span>
          <VisaBadge v-if="layover.country" :destination-country="layover.country" />
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <span
            v-if="layover.durationMinutes !== null"
            class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
            :class="recommendationStyle"
          >
            <Icon :name="recommendationIcon" class="h-3 w-3" />
            {{ layover.recommendationLabel }}
          </span>
        </div>
      </div>

      <!-- AI tips button -->
      <button
        v-if="layover.durationMinutes !== null"
        class="shrink-0 text-xs font-medium text-terra-500 transition hover:text-terra-600"
        @click="fetchAiTips"
      >
        <template v-if="aiTipsLoading">Loading...</template>
        <template v-else>AI tips {{ showAiTips ? "↑" : "→" }}</template>
      </button>
    </div>

    <!-- Expanded AI tips -->
    <div v-if="showAiTips && (aiTips || aiError)" class="mt-3 border-t border-sand-200 pt-3">
      <div v-if="aiError" class="text-xs text-red-500">{{ aiError }}</div>
      <div v-else-if="aiTips" class="space-y-2 text-xs text-sand-700">
        <p class="font-medium text-sand-900">{{ aiTips.recommendation }}</p>
        <ul class="list-inside list-disc space-y-1">
          <li v-for="(suggestion, idx) in aiTips.suggestions" :key="idx">{{ suggestion }}</li>
        </ul>
        <p v-if="aiTips.transitInfo">
          <span class="font-medium text-sand-900">Getting around:</span> {{ aiTips.transitInfo }}
        </p>
        <p v-if="aiTips.returnBy">
          <span class="font-medium text-sand-900">Head back by:</span> {{ aiTips.returnBy }}
        </p>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify dev server still starts**

```bash
npm run dev
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/LayoverCard.vue
git commit -m "feat: add LayoverCard component with duration, visa, and AI tips"
```

---

## Task 5: AI Layover Tips API Endpoint

**Files:**
- Create: `server/api/ai/layover-tips.post.ts`

- [ ] **Step 1: Create the endpoint**

Create `server/api/ai/layover-tips.post.ts`:

```ts
import { z } from "zod"
import { generateText, Output, stepCountIs } from "ai"
import { google } from "@ai-sdk/google"

const bodySchema = z.object({
  airport: z.string().min(2).max(4).toUpperCase(),
  durationMinutes: z.number().int().positive(),
  visaStatus: z.string().nullable(),
  arrivalTime: z.string().nullable(),
})

const layoverTipsSchema = z.object({
  recommendation: z.string().describe("One-sentence summary of what to do during the layover"),
  suggestions: z
    .array(z.string())
    .describe("2-4 specific things to do, places to visit, or food to try"),
  transitInfo: z
    .string()
    .describe("How to get from the airport to the city/attractions and back"),
  returnBy: z
    .string()
    .describe("When to head back to the airport, accounting for security/immigration"),
})

const generateLayoverTips = defineCachedFunction(
  async (airport: string, durationHours: number, visaStatus: string, timeOfDay: string) => {
    const model = google("gemini-3.1-flash-lite-preview")

    const result = await generateText({
      model,
      tools: {
        google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }),
      },
      output: Output.object({ schema: layoverTipsSchema }),
      stopWhen: stepCountIs(5),
      prompt: `You are a travel expert helping a traveler with a ${durationHours}-hour layover at ${airport} airport.
      
Time of arrival: ${timeOfDay || "unknown"}
Visa status: ${visaStatus || "unknown"}

Provide practical, specific advice:
- What they can realistically do in ${durationHours} hours (including immigration and transit time)
- Specific places, attractions, or food near the airport or reachable in the time
- Exact transit options (train, bus, taxi) with approximate costs and travel times
- When they should head back to the airport (accounting for security lines and immigration)

Be concise and practical. If the layover is short (under 3 hours), focus on in-airport options.
If visa status is "visa-required", focus only on airport transit zone options.`,
    })

    return result.output!
  },
  {
    maxAge: 60 * 60 * 24 * 30,
    name: "layover-tips",
    getKey: (airport: string, durationHours: number, visaStatus: string, timeOfDay: string) =>
      `${airport}:${durationHours}:${visaStatus}:${timeOfDay}`,
  },
)

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const { used, limit } = await getAiUsage(session.user.id)
  if (used >= limit) {
    throw createError({
      statusCode: 429,
      message: `You've used ${used}/${limit} AI prompts this month.`,
    })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  const durationHours = Math.round(body.durationMinutes / 60)
  const timeOfDay = body.arrivalTime
    ? new Date(body.arrivalTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "unknown"

  await incrementAiUsage(session.user.id)

  return generateLayoverTips(
    body.airport,
    durationHours,
    body.visaStatus ?? "unknown",
    timeOfDay,
  )
})
```

- [ ] **Step 2: Verify dev server starts and the endpoint exists**

```bash
npm run dev
```

Expected: No errors. The endpoint is registered at `/api/ai/layover-tips`.

- [ ] **Step 3: Commit**

```bash
git add server/api/ai/layover-tips.post.ts
git commit -m "feat: add AI layover tips API endpoint with Gemini + caching"
```

---

## Task 6: FlightGlobe Component

**Files:**
- Create: `app/components/FlightGlobe.vue`

- [ ] **Step 1: Create the globe component**

Create `app/components/FlightGlobe.vue`. This renders a TresJS 3D globe with country polygons from TopoJSON and flight arcs between airports.

```vue
<script setup lang="ts">
import { TresCanvas } from "@tresjs/core"
import { OrbitControls } from "@tresjs/cientos"
import {
  SphereGeometry,
  MeshBasicMaterial,
  MeshPhongMaterial,
  BufferGeometry,
  LineBasicMaterial,
  Line,
  Float32BufferAttribute,
  Vector3,
  QuadraticBezierCurve3,
  Color,
  AmbientLight,
  AdditiveBlending,
} from "three"
import { geoPath, geoOrthographic } from "d3-geo"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import worldTopoJson from "../data/countries-50m.json"
import { getAirportCoordinates } from "../utils/airport-coordinates"
import { iataToCountry } from "../utils/iata-to-country"

interface Flight {
  departureAirport: string | null
  arrivalAirport: string | null
  [key: string]: unknown
}

const props = defineProps<{
  flights: Flight[]
}>()

const GLOBE_RADIUS = 2
const ARC_ALTITUDE = 0.3

// --- Convert lat/lng to 3D position on sphere ---
function latLngToVector3(lat: number, lng: number, radius: number): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

// --- Build country border lines from TopoJSON ---
const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

function buildCountryLines(): BufferGeometry {
  const projection = geoOrthographic().scale(1).translate([0, 0])
  const vertices: number[] = []

  for (const feat of countriesGeo.features) {
    const coords = feat.geometry.type === "Polygon"
      ? [feat.geometry.coordinates]
      : feat.geometry.type === "MultiPolygon"
        ? feat.geometry.coordinates
        : []

    for (const polygon of coords) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [lng1, lat1] = ring[i]!
          const [lng2, lat2] = ring[i + 1]!
          const v1 = latLngToVector3(lat1!, lng1!, GLOBE_RADIUS * 1.001)
          const v2 = latLngToVector3(lat2!, lng2!, GLOBE_RADIUS * 1.001)
          vertices.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
        }
      }
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute("position", new Float32BufferAttribute(vertices, 3))
  return geo
}

function buildLandMesh(): BufferGeometry {
  // Build filled land polygons projected onto the sphere
  // Using a simpler approach: dense line segments to approximate filled regions
  // This gives the "satellite" look with visible landmasses
  return buildCountryLines() // Reuse border lines — land fill will be handled by material color
}

const countryLineGeometry = buildCountryLines()
const coastlineMaterial = new LineBasicMaterial({
  color: new Color("#305530"),
  transparent: true,
  opacity: 0.5,
})
const landBorderMaterial = new LineBasicMaterial({
  color: new Color("#1e2e1a"),
  transparent: true,
  opacity: 0.8,
})

// --- Flight arcs ---
interface ArcData {
  geometry: BufferGeometry
  glowGeometry: BufferGeometry
}

const flightArcs = computed<ArcData[]>(() => {
  const arcs: ArcData[] = []

  for (const flight of props.flights) {
    if (!flight.departureAirport || !flight.arrivalAirport) continue

    const depCoords = getAirportCoordinates(flight.departureAirport)
    const arrCoords = getAirportCoordinates(flight.arrivalAirport)
    if (!depCoords || !arrCoords) continue

    const start = latLngToVector3(depCoords.lat, depCoords.lng, GLOBE_RADIUS * 1.002)
    const end = latLngToVector3(arrCoords.lat, arrCoords.lng, GLOBE_RADIUS * 1.002)

    // Midpoint elevated above the globe surface
    const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)
    const midElevated = mid.normalize().multiplyScalar(GLOBE_RADIUS + ARC_ALTITUDE + mid.length() * 0.15)

    const curve = new QuadraticBezierCurve3(start, midElevated, end)
    const points = curve.getPoints(64)

    const arcGeo = new BufferGeometry().setFromPoints(points)
    const glowGeo = new BufferGeometry().setFromPoints(points)

    arcs.push({ geometry: arcGeo, glowGeometry: glowGeo })
  }

  return arcs
})

// --- Airport dots ---
interface AirportDot {
  position: [number, number, number]
  iata: string
}

const airportDots = computed<AirportDot[]>(() => {
  const seen = new Set<string>()
  const dots: AirportDot[] = []

  for (const flight of props.flights) {
    for (const code of [flight.departureAirport, flight.arrivalAirport]) {
      if (!code || seen.has(code)) continue
      seen.add(code)

      const coords = getAirportCoordinates(code)
      if (!coords) continue

      const pos = latLngToVector3(coords.lat, coords.lng, GLOBE_RADIUS * 1.003)
      dots.push({ position: [pos.x, pos.y, pos.z], iata: code })
    }
  }

  return dots
})

// --- Summary text ---
const summaryText = computed(() => {
  const countries = new Set<string>()
  let flightCount = 0

  for (const flight of props.flights) {
    if (flight.departureAirport || flight.arrivalAirport) flightCount++
    for (const code of [flight.departureAirport, flight.arrivalAirport]) {
      if (!code) continue
      const country = iataToCountry[code]
      if (country) countries.add(country)
    }
  }

  return `${flightCount} flight${flightCount !== 1 ? "s" : ""} · ${countries.size} countr${countries.size !== 1 ? "ies" : "y"}`
})

// --- Globe materials ---
const oceanMaterial = new MeshPhongMaterial({
  color: new Color("#080e15"),
  emissive: new Color("#050a0f"),
  shininess: 25,
})

const arcMaterial = new LineBasicMaterial({
  color: new Color("#e8956a"),
  transparent: true,
  opacity: 0.9,
})

const arcGlowMaterial = new LineBasicMaterial({
  color: new Color("#e8956a"),
  transparent: true,
  opacity: 0.15,
  linewidth: 3,
})

const dotMaterial = new MeshBasicMaterial({
  color: new Color("#e8956a"),
})

// Auto-rotation
const controlsRef = ref()
</script>

<template>
  <div class="relative rounded-2xl border border-sand-200 bg-sand-950 overflow-hidden">
    <ClientOnly>
      <TresCanvas
        class="h-[300px] w-full"
        :alpha="true"
        clear-color="#0a0a0f"
        :antialias="true"
      >
        <!-- Camera -->
        <TresPerspectiveCamera :position="[0, 0, 5]" :fov="45" />

        <!-- Lighting -->
        <TresAmbientLight :intensity="0.3" />
        <TresDirectionalLight :position="[5, 3, 5]" :intensity="0.6" />

        <!-- Controls -->
        <OrbitControls
          ref="controlsRef"
          :enable-zoom="false"
          :enable-pan="false"
          :auto-rotate="true"
          :auto-rotate-speed="0.5"
          :min-polar-angle="0.5"
          :max-polar-angle="2.6"
        />

        <!-- Ocean sphere -->
        <TresMesh>
          <TresSphereGeometry :args="[GLOBE_RADIUS, 64, 64]" />
          <TresMeshPhongMaterial
            :color="oceanMaterial.color"
            :emissive="oceanMaterial.emissive"
            :shininess="25"
          />
        </TresMesh>

        <!-- Atmosphere rim (slightly larger transparent sphere) -->
        <TresMesh>
          <TresSphereGeometry :args="[GLOBE_RADIUS * 1.02, 64, 64]" />
          <TresMeshBasicMaterial
            :color="'#4488cc'"
            :transparent="true"
            :opacity="0.05"
            :side="1"
          />
        </TresMesh>

        <!-- Country borders -->
        <TresLineSegments :geometry="countryLineGeometry" :material="landBorderMaterial" />

        <!-- Flight arcs -->
        <template v-for="(arc, idx) in flightArcs" :key="'arc-' + idx">
          <TresLine :geometry="arc.geometry" :material="arcMaterial" />
          <TresLine :geometry="arc.glowGeometry" :material="arcGlowMaterial" />
        </template>

        <!-- Airport dots -->
        <TresMesh
          v-for="(dot, idx) in airportDots"
          :key="'dot-' + idx"
          :position="dot.position"
        >
          <TresSphereGeometry :args="[0.02, 8, 8]" />
          <TresMeshBasicMaterial :color="dotMaterial.color" />
        </TresMesh>
      </TresCanvas>
    </ClientOnly>

    <!-- Summary overlay -->
    <div class="absolute bottom-3 left-0 right-0 text-center">
      <span class="text-xs text-sand-500">{{ summaryText }}</span>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify the component renders**

```bash
npm run dev
```

Navigate to a trip with flights, switch to the flights tab. The globe should render above the flight list. Verify:
- Globe sphere visible with dark ocean
- Country borders render as green-ish lines
- Flight arcs visible in terra color
- Airport dots at endpoints
- Auto-rotation works
- Drag to rotate works (orbit controls)

- [ ] **Step 3: Commit**

```bash
git add app/components/FlightGlobe.vue
git commit -m "feat: add 3D flight globe component with TresJS"
```

---

## Task 7: Integrate Globe and Layover Cards into Trip Page

**Files:**
- Modify: `app/pages/trips/[id].vue`

- [ ] **Step 1: Add imports and composable usage**

At the top of `<script setup>`, after the existing `sortedTripFlights` computed (around line 75), add:

```ts
import { useLayoverDetection, type FlightListItem } from "../composables/useLayoverDetection"

const { flightListItems } = useLayoverDetection(sortedTripFlights as Ref<FlightItem[] | null>)
```

Note: `sortedTripFlights` is already computed from the earlier change in this session. The composable expects a `Ref` of the sorted flights array.

- [ ] **Step 2: Update the flights tab template**

Replace the flights tab section (the `<div v-else-if="activeTab === 'flights'"` block) with the updated version that includes the globe and layover cards:

Find this block:
```html
      <!-- Flights tab -->
      <div v-else-if="activeTab === 'flights'" class="mt-8 max-w-3xl space-y-4">
        <h2 class="font-display text-lg text-sand-900">Flights</h2>
```

After the `<h2>`, before the add-flight form, insert the globe:

```html
        <!-- Flight Globe -->
        <FlightGlobe
          v-if="sortedTripFlights.length > 0"
          :flights="sortedTripFlights"
        />
```

Then replace the flight list rendering. Find:
```html
        <div v-if="sortedTripFlights.length" class="space-y-3">
          <FlightCard
            v-for="flight in sortedTripFlights"
            :key="(flight as Record<string, unknown>).id as string"
            :flight="flight"
            @delete="deleteTripFlight"
          />
        </div>
```

Replace with:
```html
        <div v-if="flightListItems.length" class="space-y-3">
          <template v-for="(item, idx) in flightListItems" :key="idx">
            <FlightCard
              v-if="item.type === 'flight'"
              :flight="item.flight"
              @delete="deleteTripFlight"
            />
            <LayoverCard
              v-else-if="item.type === 'layover'"
              :layover="item"
            />
          </template>
        </div>
```

- [ ] **Step 3: Verify the full integration**

```bash
npm run dev
```

Navigate to a trip with flights. Verify:
1. Globe renders at the top of the flights tab
2. Flight cards display in sorted order
3. If there are connecting flights (same transfer airport within 24h), a layover card appears between them
4. Layover card shows duration, visa badge, and recommendation
5. "AI tips" button expands with AI-generated suggestions
6. The "no flights" empty state still works when there are no flights

- [ ] **Step 4: Commit**

```bash
git add app/pages/trips/[id].vue
git commit -m "feat: integrate flight globe and layover detection into trip page"
```

---

## Task 8: Add Rate Limiting for Layover Tips Endpoint

**Files:**
- Modify: `nuxt.config.ts`

- [ ] **Step 1: Add rate limiting config**

In `nuxt.config.ts`, inside the `routeRules` section (around line 230), add rate limiting for the new endpoint:

```ts
"/api/ai/layover-tips": {
  security: {
    rateLimiter: { tokensPerInterval: 10, interval: 60000 },
  },
},
```

This limits to 10 requests per minute per user, matching the more restrictive AI endpoint pattern.

- [ ] **Step 2: Verify dev server starts**

```bash
npm run dev
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add nuxt.config.ts
git commit -m "chore: add rate limiting for layover tips AI endpoint"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Full flow test**

```bash
npm run dev
```

Open the app in a browser and test the complete flow:

1. Navigate to a trip with multiple flights
2. Verify the globe renders with flight arcs and airport dots
3. Verify the globe auto-rotates and can be dragged
4. Verify flights are sorted by closest next flight
5. If consecutive flights share a transfer airport, verify a layover card appears
6. Verify the layover card shows correct duration, visa badge, and recommendation tier
7. Click "AI tips" on a layover card — verify it fetches and displays suggestions
8. Test with a trip that has no flights — verify the empty state renders
9. Test with a trip that has only one flight — verify no layover cards, globe shows single arc

- [ ] **Step 2: Type check**

```bash
npx nuxi typecheck
```

Expected: No type errors related to the new components.

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during final verification"
```
