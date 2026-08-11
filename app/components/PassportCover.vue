<script setup lang="ts">
import { countryByAlpha2 } from "../data/countries"
import { FOIL_COLORS, passportCoverDesign } from "../data/passport-covers"

const props = withDefaults(defineProps<{ countryCode: string; width?: number }>(), { width: 46 })

const code = computed(() => props.countryCode.toUpperCase())
const design = computed(() => passportCoverDesign(code.value))
const foil = computed(() => FOIL_COLORS[design.value.foil])
const countryName = computed(() => countryByAlpha2.get(code.value)?.name ?? code.value)

/** Formal title where the real cover prints one, else the country name. */
const coverTitle = computed(() => design.value.title ?? countryName.value.toUpperCase())

// Passport booklets are 88mm x 125mm — the viewBox is the real thing at 1:1.
const height = computed(() => Math.round(props.width * (125 / 88)))

// Long titles have to shrink to stay inside the cover.
const nameSize = computed(() => {
  const length = coverTitle.value.length
  if (length > 34) return 3
  if (length > 26) return 3.6
  if (length > 20) return 4.2
  if (length > 15) return 5
  if (length > 11) return 6
  return 7
})

// Unique per instance so multiple covers on a page don't share gradient ids.
const uid = useId()
const sheenId = computed(() => `cover-sheen-${uid}`)
</script>

<template>
  <svg
    :width="width"
    :height="height"
    viewBox="0 0 88 125"
    role="img"
    :aria-label="`${countryName} passport cover`"
    class="passport-cover"
  >
    <defs>
      <linearGradient :id="sheenId" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16" />
        <stop offset="45%" stop-color="#ffffff" stop-opacity="0.04" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0.16" />
      </linearGradient>
    </defs>

    <rect x="0" y="0" width="88" height="125" rx="5" :fill="design.cover" />
    <rect x="0" y="0" width="88" height="125" rx="5" :fill="`url(#${sheenId})`" />

    <!-- Spine shading down the binding edge -->
    <rect x="0" y="0" width="7" height="125" rx="5" fill="#000000" opacity="0.18" />
    <rect x="6" y="0" width="1" height="125" fill="#ffffff" opacity="0.06" />

    <!-- Foil rule inset from the edge, as most covers have -->
    <rect
      x="11"
      y="6"
      width="71"
      height="113"
      rx="2"
      fill="none"
      :stroke="foil"
      stroke-width="0.4"
      opacity="0.45"
    />

    <g :fill="foil" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
      <text v-if="design.supra" x="48" y="20" font-size="3.4" letter-spacing="0.5" opacity="0.85">
        {{ design.supra }}
      </text>

      <text
        x="48"
        :y="design.supra ? 30 : 26"
        :font-size="nameSize"
        letter-spacing="0.4"
        font-weight="600"
      >
        {{ coverTitle }}
      </text>

      <!-- Neutral embossed medallion standing in for the national emblem -->
      <g :stroke="foil" fill="none" stroke-width="0.5" opacity="0.9">
        <circle cx="48" cy="66" r="15" />
        <circle cx="48" cy="66" r="12" opacity="0.55" />
        <path
          d="M48 57 L50.6 63.4 L57.4 63.9 L52.2 68.2 L53.9 74.8 L48 71.2 L42.1 74.8 L43.8 68.2 L38.6 63.9 L45.4 63.4 Z"
        />
      </g>

      <text x="48" y="99" font-size="6" letter-spacing="1.4" font-weight="600">PASSPORT</text>
      <text
        v-if="design.localWord"
        x="48"
        y="106"
        font-size="4"
        letter-spacing="0.4"
        opacity="0.85"
      >
        {{ design.localWord }}
      </text>
    </g>

    <!-- ICAO e-passport chip symbol -->
    <g
      v-if="design.biometric"
      :stroke="foil"
      fill="none"
      stroke-width="0.55"
      stroke-linecap="round"
      opacity="0.9"
    >
      <rect x="41.5" y="112.5" width="5" height="7" rx="0.8" />
      <line x1="44" y1="112.5" x2="44" y2="119.5" />
      <path d="M48.5 114 a3.4 3.4 0 0 1 0 4" />
      <path d="M50.6 112.4 a6 6 0 0 1 0 7.2" />
    </g>
  </svg>
</template>

<style scoped>
.passport-cover {
  border-radius: 5px;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.18),
    0 4px 10px rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
}
</style>
