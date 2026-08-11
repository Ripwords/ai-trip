<script setup lang="ts">
import { countryByAlpha2, countryFlag } from "../data/countries"
import { FOIL_COLORS, passportCoverDesign } from "../data/passport-covers"

const props = withDefaults(defineProps<{ countryCode: string; width?: number }>(), { width: 46 })

const code = computed(() => props.countryCode.toUpperCase())
const design = computed(() => passportCoverDesign(code.value))
const flag = computed(() => countryFlag(code.value))
const countryName = computed(() => countryByAlpha2.get(code.value)?.name ?? code.value)

// Booklet proportions, kept from the real thing: 88mm x 125mm.
const height = computed(() => Math.round(props.width * (125 / 88)))
</script>

<template>
  <div
    class="cover"
    role="img"
    :aria-label="`${countryName} passport`"
    :style="{
      '--cover': design.cover,
      '--foil': FOIL_COLORS[design.foil],
      width: `${width}px`,
      height: `${height}px`,
    }"
  >
    <span class="cover__spine" aria-hidden="true" />
    <span class="cover__flag" aria-hidden="true">{{ flag }}</span>
    <span class="cover__label" aria-hidden="true">PASSPORT</span>
  </div>
</template>

<style scoped>
/* Flat illustration — no gradients or drop shadows, so it reads as a drawn
   icon rather than an attempt at a photograph. */
.cover {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8%;
  flex-shrink: 0;
  border-radius: 9%;
  background: var(--cover);
  container-type: size;
  /* Inset rule, the way a passport cover is usually drawn */
  box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.13);
}

/* Binding edge */
.cover__spine {
  position: absolute;
  inset: 0 auto 0 0;
  width: 9%;
  border-radius: 9% 0 0 9%;
  background: rgb(0 0 0 / 0.22);
  border-right: 1px solid rgb(255 255 255 / 0.1);
}

/* Plaque behind the flag, so red flags stay legible on red covers */
.cover__flag {
  display: grid;
  place-items: center;
  padding: 4% 6%;
  border-radius: 14%;
  background: rgb(255 255 255 / 0.16);
  font-size: 30cqh;
  line-height: 1;
  /* Nudge clear of the spine so the flag sits optically centred. */
  margin-left: 6%;
  /* Regional-indicator letters are the fallback where flag emoji don't
     render (Windows) — keep them legible against the cover. */
  color: var(--foil);
  letter-spacing: -0.04em;
}

.cover__label {
  margin-left: 6%;
  color: var(--foil);
  font-size: 9cqh;
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 1;
}
</style>
