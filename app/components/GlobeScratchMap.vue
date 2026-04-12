<script setup lang="ts">
import { OrbitControls } from "@tresjs/cientos"
import {
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  MeshPhongMaterial,
  Mesh,
  Color,
  Vector3,
  Raycaster,
  Vector2,
} from "three"
import {
  getCountryFeatures,
  buildCountryGeometry,
  buildMergedGeometry,
  buildBorderLines,
  getCountryCentroid,
  latLngToVector3,
  GLOBE_RADIUS,
  type CountryGeoFeature,
  type MergedCountryResult,
} from "../utils/globe-countries"
import { countryByNumeric, type CountryInfo } from "../data/countries"

export type VisitType = "visited" | "layover" | "want_to_visit"

const props = defineProps<{
  visitMap: Map<string, VisitType>
  visaStatusMap: Record<string, { visaStatus: string; maxStayDays: number | null }>
}>()

const emit = defineEmits<{
  countryClick: [country: CountryInfo]
  toggleView: []
}>()

const { isDark } = useDarkMode()

// --- Theme ---
const theme = computed(() =>
  isDark.value
    ? {
        clearColor: "#1a1714",
        ocean: "#1e1b16",
        oceanEmissive: "#15120e",
        atmosphere: "#e85d3a",
        atmosphereOpacity: 0.04,
        borderColor: "#4a8450",
        borderOpacity: 0.35,
        visited: "#f07b5a",
        layover: "#4aa5b9",
        want: "#a78bfa",
        unvisited: "#302b24",
        unvisitedEmissive: "#1a1714",
        hoverEmissive: "#555555",
        ambientIntensity: 0.5,
        directionalIntensity: 0.9,
      }
    : {
        clearColor: "#faf8f5",
        ocean: "#d9eef3",
        oceanEmissive: "#b3dde7",
        atmosphere: "#7dc3d4",
        atmosphereOpacity: 0.06,
        borderColor: "#3a6a3f",
        borderOpacity: 0.5,
        visited: "#f07b5a",
        layover: "#4aa5b9",
        want: "#a78bfa",
        unvisited: "#e8e0d4",
        unvisitedEmissive: "#d4c8b8",
        hoverEmissive: "#aaaaaa",
        ambientIntensity: 0.9,
        directionalIntensity: 1.4,
      },
)

// --- Country data (computed once) ---
const allFeatures = getCountryFeatures()
const featureById = new Map<string, CountryGeoFeature>()
for (const f of allFeatures) {
  featureById.set(f.id, f)
}

// --- Categorize countries by visit status ---
function getVisitTypeForFeature(feat: CountryGeoFeature): VisitType | null {
  if (!feat.info) return null
  return props.visitMap.get(feat.info.alpha2) ?? null
}

// --- Build meshes reactively ---
interface MarkedCountryMesh {
  mesh: Mesh
  feature: CountryGeoFeature
  visitType: VisitType
}

const markedMeshes = computed<MarkedCountryMesh[]>(() => {
  const t = theme.value
  const meshes: MarkedCountryMesh[] = []

  for (const feat of allFeatures) {
    const visitType = getVisitTypeForFeature(feat)
    if (!visitType) continue

    const color = visitType === "visited" ? t.visited : visitType === "layover" ? t.layover : t.want
    const material = new MeshPhongMaterial({
      color: new Color(color),
      shininess: 20,
    })
    const geometry = buildCountryGeometry(feat)
    const mesh = new Mesh(geometry, material)
    mesh.userData = { countryId: feat.id, visitType }
    meshes.push({ mesh, feature: feat, visitType })
  }

  return meshes
})

const mergedResult = computed<MergedCountryResult>(() => {
  const unvisited = allFeatures.filter((f) => !getVisitTypeForFeature(f))
  return buildMergedGeometry(unvisited)
})

const mergedMaterial = computed(
  () =>
    new MeshPhongMaterial({
      color: new Color(theme.value.unvisited),
      emissive: new Color(theme.value.unvisitedEmissive),
      shininess: 10,
    }),
)

const mergedMesh = computed(() => {
  const mesh = new Mesh(mergedResult.value.geometry, mergedMaterial.value)
  mesh.userData = { isMerged: true }
  return mesh
})

// --- Borders ---
const borderGeometry = buildBorderLines()
const borderMaterial = computed(
  () =>
    new LineBasicMaterial({
      color: new Color(theme.value.borderColor),
      transparent: true,
      opacity: theme.value.borderOpacity,
    }),
)
const borderLines = computed(() => new LineSegments(borderGeometry, borderMaterial.value))

// --- Stats ---
const visitedCount = computed(
  () => [...props.visitMap.values()].filter((v) => v === "visited").length,
)
const layoverCount = computed(
  () => [...props.visitMap.values()].filter((v) => v === "layover").length,
)
const wantCount = computed(
  () => [...props.visitMap.values()].filter((v) => v === "want_to_visit").length,
)

// --- Tooltip (desktop only) ---
const isTouch = ref(false)
onMounted(() => {
  isTouch.value = window.matchMedia("(pointer: coarse)").matches
})

const tooltipVisible = ref(false)
const tooltipX = ref(0)
const tooltipY = ref(0)
const tooltipCountry = ref<CountryInfo | null>(null)
const tooltipVisitType = ref<VisitType | null>(null)

const tooltipVisa = computed(() => {
  if (!tooltipCountry.value) return null
  const status = props.visaStatusMap[tooltipCountry.value.alpha2]
  if (!status) return null
  const config: Record<string, { label: string; colorClass: string }> = {
    "visa-free": { label: "Visa Free", colorClass: "bg-green-500/20 text-green-400" },
    "visa-on-arrival": { label: "On Arrival", colorClass: "bg-blue-500/20 text-blue-400" },
    evisa: { label: "e-Visa", colorClass: "bg-amber-500/20 text-amber-400" },
    "visa-required": { label: "Visa Required", colorClass: "bg-red-500/20 text-red-400" },
  }
  const c = config[status.visaStatus]
  if (!c) return null
  return { ...c, maxStayDays: status.maxStayDays }
})

function resolveCountryFromMergedFace(faceIndex: number): CountryInfo | undefined {
  const countryId = mergedResult.value.faceToCountryId[faceIndex]
  if (!countryId) return undefined
  const feat = featureById.get(countryId)
  return feat?.info
}

function handleCountryPointerOver(info: CountryInfo, event: PointerEvent) {
  if (isTouch.value) return
  tooltipCountry.value = info
  tooltipVisitType.value = props.visitMap.get(info.alpha2) ?? null
  tooltipX.value = event.clientX
  tooltipY.value = event.clientY
  tooltipVisible.value = true
}

function handleCountryPointerOut() {
  tooltipVisible.value = false
  tooltipCountry.value = null
}

function handlePointerMove(event: PointerEvent) {
  if (tooltipVisible.value) {
    tooltipX.value = event.clientX
    tooltipY.value = event.clientY
  }
}

// --- Click handling ---
function handleCountryClick(info: CountryInfo) {
  emit("countryClick", info)
  animateToCentroid(info)
}

// --- Auto-center animation ---
const controlsRef = ref()

function animateToCentroid(info: CountryInfo) {
  // Find the feature for this country
  const feat = allFeatures.find((f) => f.info?.alpha2 === info.alpha2)
  if (!feat) return

  const centroid = getCountryCentroid(feat)
  const target = latLngToVector3(centroid.lat, centroid.lng, 0)
  const cameraTarget = latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS)
    .normalize()
    .multiplyScalar(5)

  // Simple lerp animation
  const controls = controlsRef.value?.value
  if (!controls) return

  const startTarget = controls.target.clone()
  const startPos = controls.object.position.clone()
  const duration = 500
  const startTime = Date.now()

  function animate() {
    const elapsed = Date.now() - startTime
    const t = Math.min(elapsed / duration, 1)
    const ease = t * (2 - t) // ease-out quad

    controls.target.lerpVectors(startTarget, target, ease)
    controls.object.position.lerpVectors(startPos, cameraTarget, ease)
    controls.update()

    if (t < 1) requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)
}

// --- Fullscreen ---
const containerRef = ref<HTMLElement>()
const isFullscreen = ref(false)

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  document.body.style.overflow = isFullscreen.value ? "hidden" : ""
}
</script>

<template>
  <div
    ref="containerRef"
    class="relative w-full overflow-hidden rounded-2xl border border-sand-200"
    :class="isFullscreen ? 'fixed inset-0 z-50 rounded-none border-0' : 'h-[500px] sm:h-[600px]'"
    @pointermove="handlePointerMove"
  >
    <ClientOnly>
      <TresCanvas :alpha="true" :clear-color="theme.clearColor" :antialias="true">
        <TresPerspectiveCamera :position="[0, 0, 5]" :fov="45" />

        <TresAmbientLight :intensity="theme.ambientIntensity" />
        <TresDirectionalLight :position="[5, 3, 5]" :intensity="theme.directionalIntensity" />

        <OrbitControls
          ref="controlsRef"
          :enable-zoom="true"
          :enable-pan="false"
          :auto-rotate="false"
          :min-distance="3"
          :max-distance="8"
          :enable-damping="true"
        />

        <!-- Ocean sphere -->
        <TresMesh>
          <TresSphereGeometry :args="[GLOBE_RADIUS, 64, 64]" />
          <TresMeshPhongMaterial
            :color="theme.ocean"
            :emissive="theme.oceanEmissive"
            :shininess="40"
          />
        </TresMesh>

        <!-- Atmosphere rim -->
        <TresMesh>
          <TresSphereGeometry :args="[GLOBE_RADIUS * 1.02, 64, 64]" />
          <TresMeshBasicMaterial
            :color="theme.atmosphere"
            :transparent="true"
            :opacity="theme.atmosphereOpacity"
            :side="1"
          />
        </TresMesh>

        <!-- Country borders -->
        <primitive :object="borderLines" />

        <!-- Merged unvisited countries -->
        <primitive
          :object="mergedMesh"
          @click="
            (e: any) => {
              const info = resolveCountryFromMergedFace(e.faceIndex)
              if (info) handleCountryClick(info)
            }
          "
          @pointerover="
            (e: any) => {
              const info = resolveCountryFromMergedFace(e.faceIndex)
              if (info) handleCountryPointerOver(info, e.nativeEvent)
            }
          "
          @pointerout="handleCountryPointerOut"
        />

        <!-- Individual marked country meshes -->
        <primitive
          v-for="mc in markedMeshes"
          :key="mc.feature.id"
          :object="mc.mesh"
          @click="() => mc.feature.info && handleCountryClick(mc.feature.info)"
          @pointerover="
            (e: any) => mc.feature.info && handleCountryPointerOver(mc.feature.info, e.nativeEvent)
          "
          @pointerout="handleCountryPointerOut"
        />
      </TresCanvas>
    </ClientOnly>

    <!-- Tooltip (desktop only) -->
    <div
      v-if="tooltipVisible && tooltipCountry && !isTouch"
      class="pointer-events-none fixed z-50 rounded-lg bg-sand-900/90 px-3 py-2 text-xs text-sand-100 shadow-lg backdrop-blur-sm"
      :style="{ left: tooltipX + 12 + 'px', top: tooltipY - 10 + 'px' }"
    >
      <p class="font-semibold">{{ tooltipCountry.name }}</p>
      <p v-if="tooltipVisitType" class="mt-0.5 text-sand-400">
        {{
          tooltipVisitType === "visited"
            ? "Visited"
            : tooltipVisitType === "layover"
              ? "Layover"
              : "Want to visit"
        }}
      </p>
      <div v-if="tooltipVisa" class="mt-1">
        <span
          class="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
          :class="tooltipVisa.colorClass"
        >
          {{ tooltipVisa.label }}
          <template v-if="tooltipVisa.maxStayDays">({{ tooltipVisa.maxStayDays }}d)</template>
        </span>
      </div>
    </div>

    <!-- Fullscreen toggle -->
    <button
      class="map-btn absolute left-3 top-3 flex h-11 w-11 items-center justify-center rounded-xl shadow-md transition sm:h-8 sm:w-8 sm:rounded-lg sm:shadow"
      :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
      @click="toggleFullscreen"
    >
      <Icon
        :name="isFullscreen ? 'lucide:minimize-2' : 'lucide:maximize'"
        class="h-5 w-5 sm:h-4 sm:w-4"
      />
    </button>

    <!-- Controls: view toggle -->
    <div class="absolute right-3 top-3 flex flex-col gap-1.5">
      <button
        class="map-btn flex h-11 w-11 items-center justify-center rounded-xl shadow-md transition sm:h-8 sm:w-8 sm:rounded-lg sm:shadow"
        title="Switch to 2D map"
        @click="emit('toggleView')"
      >
        <Icon name="lucide:map" class="h-5 w-5 sm:h-4 sm:w-4" />
      </button>
    </div>

    <!-- Stats overlay -->
    <div
      class="map-overlay map-overlay-border absolute bottom-3 left-3 rounded-xl px-3 py-1.5 backdrop-blur-sm"
    >
      <p class="map-overlay-text text-sm font-medium">
        <span class="map-overlay-accent text-lg font-bold">{{ visitedCount }}</span>
        visited
        <template v-if="layoverCount">
          <span class="mx-1 opacity-40">&middot;</span>
          <span class="map-layover-accent text-lg font-bold">{{ layoverCount }}</span>
          layover
        </template>
        <template v-if="wantCount">
          <span class="mx-1 opacity-40">&middot;</span>
          <span class="map-want-accent text-lg font-bold">{{ wantCount }}</span>
          wishlist
        </template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.map-btn {
  background: var(--color-sand-50);
  color: var(--color-sand-700);
}
.map-btn:hover {
  background: var(--color-sand-200);
}
.map-overlay {
  background: var(--color-sand-50);
}
.map-overlay-border {
  border: 1px solid var(--color-sand-200);
}
.map-overlay-text {
  color: var(--color-sand-600);
}
.map-overlay-accent {
  color: var(--color-terra-500);
}
.map-layover-accent {
  color: var(--color-ocean-500);
}
.map-want-accent {
  color: #a78bfa;
}
</style>
