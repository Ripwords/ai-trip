<script setup lang="ts">
import { OrbitControls } from "@tresjs/cientos"
import {
  MeshBasicMaterial,
  SphereGeometry,
  Mesh,
  Group,
  Raycaster,
  Vector2,
  CanvasTexture,
  SRGBColorSpace,
  RepeatWrapping,
  ClampToEdgeWrapping,
} from "three"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import worldTopoJson from "../data/countries-50m.json"
import { countryByNumeric, countryByAlpha2, type CountryInfo } from "../data/countries"
import { latLngToVector3, GLOBE_RADIUS, type VisitType } from "../utils/globe-countries"
import { geoEquirectangular, geoPath } from "d3-geo"
import { drawFlatWorld } from "../utils/flat-world"
import { mapPalette } from "../utils/map-palette"

const props = defineProps<{
  visitMap: Map<string, VisitType>
  visaStatusMap: Record<string, { visaStatus: string; maxStayDays: number | null }>
}>()

const emit = defineEmits<{
  countryClick: [country: CountryInfo]
  toggleView: []
}>()

const { isDark } = useDarkMode()
const prefersReducedMotion = useReducedMotion()

// --- Theme: map colours come from the shared Google-style palette ---
const palette = computed(() => mapPalette(isDark.value))
const theme = computed(() =>
  isDark.value
    ? {
        clearColor: "#1f2023",
        overlayBg: "rgba(42, 43, 47, 0.92)",
        overlayBorder: "rgba(220, 229, 230, 0.1)",
        overlayText: "#e8eaed",
        overlayAccent: "#f28b82",
        layoverAccent: "#8ab4f8",
        wantAccent: "#81c995",
        btnBg: "rgba(42, 43, 47, 0.9)",
        btnText: "#e8eaed",
        btnHover: "rgba(44, 58, 62, 0.96)",
        tooltipBg: "#2a2b2f",
        tooltipText: "#e8eaed",
        tooltipBadgeBg: "rgba(220, 229, 230, 0.12)",
      }
    : {
        clearColor: "#f8f9fa",
        overlayBg: "rgba(255, 255, 255, 0.92)",
        overlayBorder: "rgba(32, 33, 36, 0.1)",
        overlayText: "#202124",
        overlayAccent: "#d93025",
        layoverAccent: "#1a73e8",
        wantAccent: "#188038",
        btnBg: "rgba(255, 255, 255, 0.85)",
        btnText: "#202124",
        btnHover: "rgba(255, 255, 255, 1)",
        tooltipBg: "#202124",
        tooltipText: "#f8f9fa",
        tooltipBadgeBg: "rgba(255, 255, 255, 0.15)",
      },
)

// --- Parse TopoJSON ---
const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

// --- Equirectangular projection for textures ---
const TEX_WIDTH = 4096
const TEX_HEIGHT = 2048

const projection = geoEquirectangular()
  .scale(TEX_WIDTH / (2 * Math.PI))
  .translate([TEX_WIDTH / 2, TEX_HEIGHT / 2])

const pathGenerator = geoPath().projection(projection)

const allFeatures = countriesGeo.features.map((feat) => {
  const numericId = String(feat.id).padStart(3, "0")
  return { id: numericId, info: countryByNumeric.get(numericId), geoFeature: feat }
})

// --- ID texture for click detection ---
function renderIdTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = TEX_WIDTH
  canvas.height = TEX_HEIGHT
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!

  // Disable anti-aliasing — blended edge pixels decode to random country IDs
  ctx.imageSmoothingEnabled = false

  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, TEX_WIDTH, TEX_HEIGHT)

  for (const feat of allFeatures) {
    const id = parseInt(feat.id, 10)
    const r = ((id + 1) >> 8) & 0xff
    const g = (id + 1) & 0xff
    ctx.fillStyle = `rgb(${r},${g},0)`
    ctx.beginPath()
    pathGenerator.context(ctx)(feat.geoFeature)
    ctx.fill()
  }

  // Boost clickability of tiny countries (Singapore, Brunei, Hong Kong,
  // Macao, ...): their fills span only ~1px and the anti-alias guard rejects
  // them, so give each small country a minimum-radius clickable disc at its
  // curated centre. Drawn smallest-last so a tiny country wins over a larger
  // neighbour it sits next to.
  const MIN_CLICK_RADIUS = 5 // px in the 4096-wide ID texture (~50 km)
  const smallCountries = allFeatures
    .map((feat) => {
      const [[x0, y0], [x1, y1]] = pathGenerator.bounds(feat.geoFeature)
      return { feat, area: (x1 - x0) * (y1 - y0) }
    })
    .filter((c) => Number.isFinite(c.area) && c.area < 400) // < ~20×20 px
    .toSorted((a, b) => b.area - a.area)

  for (const { feat } of smallCountries) {
    if (!feat.info) continue
    const p = projection([feat.info.lng, feat.info.lat])
    if (!p) continue
    const id = parseInt(feat.id, 10)
    const r = ((id + 1) >> 8) & 0xff
    const g = (id + 1) & 0xff
    ctx.fillStyle = `rgb(${r},${g},0)`
    ctx.beginPath()
    ctx.arc(p[0], p[1], MIN_CLICK_RADIUS, 0, Math.PI * 2)
    ctx.fill()
  }

  return canvas
}

/** Convert a 3D hit point on the globe to lat/lng, then look up the ID texture.
 *  This avoids Three.js UV interpolation which breaks at the antimeridian seam. */
function resolveCountryFromPoint(
  point: { x: number; y: number; z: number },
  idCanvas: HTMLCanvasElement,
): CountryInfo | undefined {
  // Convert 3D point to lat/lng (reverse of latLngToVector3)
  const r = Math.sqrt(point.x ** 2 + point.y ** 2 + point.z ** 2)
  const lat = 90 - Math.acos(point.y / r) * (180 / Math.PI)
  let lng = Math.atan2(point.z, -point.x) * (180 / Math.PI) - 180
  // Normalize longitude to [-180, 180]
  if (lng < -180) lng += 360
  if (lng > 180) lng -= 360

  // Map lat/lng to texture pixel using same projection as renderIdTexture
  const lambda = (lng * Math.PI) / 180
  const phi = (lat * Math.PI) / 180
  const scale = TEX_WIDTH / (2 * Math.PI)
  const px = Math.floor(lambda * scale + TEX_WIDTH / 2)
  const py = Math.floor(-phi * scale + TEX_HEIGHT / 2)

  const x = ((px % TEX_WIDTH) + TEX_WIDTH) % TEX_WIDTH
  const y = Math.max(0, Math.min(TEX_HEIGHT - 1, py))

  const ctx = idCanvas.getContext("2d")!

  // Read a 3x3 area in one call (much faster than 5 separate getImageData calls)
  const sx = Math.max(0, x - 1)
  const sy = Math.max(0, y - 1)
  const sw = Math.min(3, TEX_WIDTH - sx)
  const sh = Math.min(3, TEX_HEIGHT - sy)
  const data = ctx.getImageData(sx, sy, sw, sh).data

  // Center pixel is at offset (x - sx, y - sy) in the 3x3 grid
  const cx = x - sx
  const cy = y - sy
  const ci = (cy * sw + cx) * 4
  const centerEncoded = (data[ci]! << 8) | data[ci + 1]!
  if (centerEncoded === 0) return undefined

  // Anti-alias guard: center must match at least one direct neighbor
  const neighborOffsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]
  let confirmed = false
  for (const [dx, dy] of neighborOffsets) {
    const nx = cx + dx!
    const ny = cy + dy!
    if (nx < 0 || nx >= sw || ny < 0 || ny >= sh) continue
    const ni = (ny * sw + nx) * 4
    const ne = (data[ni]! << 8) | data[ni + 1]!
    if (ne === centerEncoded) {
      confirmed = true
      break
    }
  }

  if (!confirmed) return undefined

  const numericId = String(centerEncoded - 1).padStart(3, "0")
  return countryByNumeric.get(numericId)
}

// --- Visit markers: countries are filled on the texture, but the smallest
// (Singapore, Malta, ...) would vanish at globe scale, so they also get a dot.
const SMALL_COUNTRY_AREA = 400 // px² in the 4096-wide texture, about 20×20 px
const smallCountryIds = new Set(
  allFeatures
    .filter((feat) => {
      const [[x0, y0], [x1, y1]] = pathGenerator.bounds(feat.geoFeature)
      const area = (x1 - x0) * (y1 - y0)
      return Number.isFinite(area) && area < SMALL_COUNTRY_AREA
    })
    .map((feat) => feat.info?.alpha2),
)
const markerGeo = new SphereGeometry(0.022, 12, 12)
const markersGroup = new Group()

function visitColor(visitType: VisitType): string {
  const p = palette.value
  return visitType === "visited" ? p.visited : visitType === "layover" ? p.layover : p.want
}

function clearMarkers() {
  for (const child of markersGroup.children) {
    const mat = (child as Mesh).material
    if (mat && !Array.isArray(mat)) (mat as MeshBasicMaterial).dispose()
  }
  markersGroup.clear()
}

function buildMarkers() {
  clearMarkers()
  for (const [alpha2, visitType] of props.visitMap) {
    if (!smallCountryIds.has(alpha2)) continue
    const info = countryByAlpha2.get(alpha2)
    if (!info) continue
    const dot = new Mesh(
      markerGeo,
      new MeshBasicMaterial({ color: visitColor(visitType), toneMapped: false }),
    )
    dot.position.copy(latLngToVector3(info.lat, info.lng, GLOBE_RADIUS + 0.005))
    dot.userData.country = info
    markersGroup.add(dot)
  }
}

// --- Globe mesh: a flat Google-style map, unlit and not tone-mapped so its
// colours match the 2D map exactly ---
const globeGeo = new SphereGeometry(GLOBE_RADIUS, 128, 128)
const globeMat = new MeshBasicMaterial({ toneMapped: false })
const globeMesh = new Mesh(globeGeo, globeMat)

// Invisible sphere used only for raycasting, so hover/click stay cheap.
const raycastMesh = new Mesh(
  new SphereGeometry(GLOBE_RADIUS, 48, 48),
  new MeshBasicMaterial({ visible: false }),
)

let idCanvas: HTMLCanvasElement | null = null
let mapCanvas: HTMLCanvasElement | null = null
let mapTexture: CanvasTexture | null = null

function paintGlobe() {
  if (!mapCanvas) return
  const alpha2ById = new Map(allFeatures.map((f) => [f.id, f.info?.alpha2]))
  drawFlatWorld(
    mapCanvas.getContext("2d")!,
    TEX_WIDTH,
    TEX_HEIGHT,
    allFeatures,
    palette.value,
    (id) => {
      const alpha2 = alpha2ById.get(id)
      const visitType = alpha2 ? props.visitMap.get(alpha2) : undefined
      return visitType ? visitColor(visitType) : undefined
    },
  )
  if (mapTexture) mapTexture.needsUpdate = true
}

onMounted(() => {
  idCanvas = renderIdTexture()
  mapCanvas = document.createElement("canvas")
  mapCanvas.width = TEX_WIDTH
  mapCanvas.height = TEX_HEIGHT
  paintGlobe()
  mapTexture = new CanvasTexture(mapCanvas)
  mapTexture.colorSpace = SRGBColorSpace
  mapTexture.wrapS = RepeatWrapping
  mapTexture.wrapT = ClampToEdgeWrapping
  mapTexture.anisotropy = 4
  globeMat.map = mapTexture
  globeMat.needsUpdate = true
  buildMarkers()
})

// Repaint when visits or theme change
watch([() => props.visitMap, palette], () => {
  paintGlobe()
  buildMarkers()
})

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

// --- Tooltip ---
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
  const config: Record<string, { label: string; cls: string }> = {
    "visa-free": { label: "Visa Free", cls: "globe-visa-free" },
    "visa-on-arrival": { label: "On Arrival", cls: "globe-visa-arrival" },
    evisa: { label: "e-Visa", cls: "globe-visa-evisa" },
    "visa-required": { label: "Visa Required", cls: "globe-visa-required" },
  }
  const c = config[status.visaStatus]
  if (!c) return null
  return { ...c, maxStayDays: status.maxStayDays }
})

// --- Manual raycasting ---
const containerRef = ref<HTMLElement | null>(null)
const controlsRef = ref()
const raycaster = new Raycaster()
const pointer = new Vector2()

function getControls() {
  const instanceRef = controlsRef.value?.instance
  return instanceRef?.value ?? instanceRef
}

function raycastCountry(event: MouseEvent): CountryInfo | undefined {
  if (!idCanvas) return undefined
  const canvas = containerRef.value?.querySelector("canvas")
  const controls = getControls()
  if (!canvas || !controls?.object) return undefined

  const rect = canvas.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(pointer, controls.object)
  const nearest = raycaster.intersectObject(raycastMesh)[0]

  // A highlighted marker dot always selects its own country — as long as it's on
  // the near side of the globe (closer than the surface hit, not showing through).
  const markerHit = raycaster.intersectObjects(markersGroup.children, false)[0]
  if (markerHit && (!nearest || markerHit.distance <= nearest.distance + 0.02)) {
    const info = markerHit.object.userData.country as CountryInfo | undefined
    if (info) return info
  }

  if (!nearest) return undefined
  return resolveCountryFromPoint(nearest.point, idCanvas)
}

let pointerDownX = 0
let pointerDownY = 0

function onPointerDown(event: PointerEvent) {
  pointerDownX = event.clientX
  pointerDownY = event.clientY
}

function onCanvasClick(event: MouseEvent) {
  const dx = event.clientX - pointerDownX
  const dy = event.clientY - pointerDownY
  if (dx * dx + dy * dy > 25) return

  const info = raycastCountry(event)
  if (info) {
    emit("countryClick", info)
    animateToCentroid(info)
  }
}

let lastMoveTime = 0
function onCanvasPointerMove(event: PointerEvent) {
  if (isTouch.value) {
    tooltipVisible.value = false
    return
  }
  const now = performance.now()
  if (now - lastMoveTime < 33) return
  lastMoveTime = now

  const info = raycastCountry(event)
  if (info) {
    tooltipCountry.value = info
    tooltipVisitType.value = props.visitMap.get(info.alpha2) ?? null
    tooltipX.value = event.clientX
    tooltipY.value = event.clientY
    tooltipVisible.value = true
  } else {
    tooltipVisible.value = false
    tooltipCountry.value = null
  }
}

function onCanvasPointerLeave() {
  tooltipVisible.value = false
  tooltipCountry.value = null
}

// --- Canvas listener attachment ---
let attachedCanvas: HTMLCanvasElement | null = null

function attachCanvasListeners(canvas: HTMLCanvasElement) {
  if (attachedCanvas === canvas) return
  detachCanvasListeners()
  attachedCanvas = canvas
  canvas.addEventListener("pointerdown", onPointerDown)
  canvas.addEventListener("click", onCanvasClick)
  canvas.addEventListener("pointermove", onCanvasPointerMove)
  canvas.addEventListener("pointerleave", onCanvasPointerLeave)
}

function detachCanvasListeners() {
  if (!attachedCanvas) return
  attachedCanvas.removeEventListener("pointerdown", onPointerDown)
  attachedCanvas.removeEventListener("click", onCanvasClick)
  attachedCanvas.removeEventListener("pointermove", onCanvasPointerMove)
  attachedCanvas.removeEventListener("pointerleave", onCanvasPointerLeave)
  attachedCanvas = null
}

onMounted(() => {
  const container = containerRef.value
  if (!container) return

  const existing = container.querySelector("canvas")
  if (existing) {
    attachCanvasListeners(existing)
    return
  }

  const observer = new MutationObserver(() => {
    const canvas = container.querySelector("canvas")
    if (canvas) {
      attachCanvasListeners(canvas)
      observer.disconnect()
    }
  })
  observer.observe(container, { childList: true, subtree: true })
})

onUnmounted(() => {
  detachCanvasListeners()
})

// Far enough that the whole globe fits the frame with a margin.
const CAMERA_DISTANCE = 6.2

// --- Auto-center animation ---
function animateToCentroid(info: CountryInfo) {
  const target = latLngToVector3(info.lat, info.lng, 0)
  const cameraTarget = latLngToVector3(info.lat, info.lng, GLOBE_RADIUS)
    .normalize()
    .multiplyScalar(CAMERA_DISTANCE)

  const controls = getControls()
  if (!controls) return

  // Respect reduced-motion: snap directly to the destination instead of flying.
  if (prefersReducedMotion.value) {
    controls.target.copy(target)
    controls.object.position.copy(cameraTarget)
    controls.update()
    return
  }

  const startTarget = controls.target.clone()
  const startPos = controls.object.position.clone()
  const duration = 500
  const startTime = Date.now()

  function animate() {
    const elapsed = Date.now() - startTime
    const t = Math.min(elapsed / duration, 1)
    const ease = t * (2 - t)

    controls.target.lerpVectors(startTarget, target, ease)
    controls.object.position.lerpVectors(startPos, cameraTarget, ease)
    controls.update()

    if (t < 1) requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)
}
</script>

<template>
  <div
    ref="containerRef"
    class="globe-container relative h-[500px] w-full overflow-hidden rounded-2xl sm:h-[600px]"
  >
    <ClientOnly>
      <TresCanvas :alpha="true" :clear-color="theme.clearColor" :antialias="true">
        <!-- Default view: Malaysia (lat 4.2, lng 102) -->
        <TresPerspectiveCamera :position="[-1.28, 0.46, -6.06]" :fov="45" />

        <OrbitControls
          ref="controlsRef"
          :enable-zoom="true"
          :enable-pan="false"
          :auto-rotate="false"
          :min-distance="2.5"
          :max-distance="8"
          :rotate-speed="0.4"
          :zoom-speed="0.6"
          :enable-damping="true"
        />

        <!-- Flat Google-style globe -->
        <primitive :object="globeMesh" />

        <!-- Invisible smooth sphere for raycasting -->
        <primitive :object="raycastMesh" />

        <!-- Dots for visited countries too small to see as a fill -->
        <primitive :object="markersGroup" />
      </TresCanvas>
    </ClientOnly>

    <!-- Tooltip -->
    <Transition name="globe-tooltip">
      <div
        v-if="tooltipVisible && tooltipCountry && !isTouch"
        class="globe-tooltip pointer-events-none fixed z-50"
        :style="{ left: tooltipX + 14 + 'px', top: tooltipY - 12 + 'px' }"
      >
        <p class="globe-tooltip-name">{{ tooltipCountry.name }}</p>
        <p v-if="tooltipVisitType" class="globe-tooltip-status">
          {{
            tooltipVisitType === "visited"
              ? "Visited"
              : tooltipVisitType === "layover"
                ? "Layover"
                : "Want to visit"
          }}
        </p>
        <div v-if="tooltipVisa" class="mt-1">
          <span class="globe-tooltip-visa" :class="tooltipVisa.cls">
            {{ tooltipVisa.label }}
            <template v-if="tooltipVisa.maxStayDays">({{ tooltipVisa.maxStayDays }}d)</template>
          </span>
        </div>
      </div>
    </Transition>

    <!-- View toggle -->
    <div class="absolute right-3 top-3 flex flex-col gap-1.5">
      <button
        type="button"
        class="globe-btn focus-ring flex h-11 w-11 items-center justify-center rounded-xl shadow-md transition sm:h-8 sm:w-8 sm:rounded-lg sm:shadow"
        aria-label="Switch to 2D map"
        @click="emit('toggleView')"
      >
        <Icon name="lucide:map" class="h-5 w-5 sm:h-4 sm:w-4" />
      </button>
    </div>

    <!-- Stats -->
    <div class="globe-overlay absolute bottom-3 left-3 rounded-xl px-3 py-1.5">
      <p class="globe-overlay-text text-sm font-medium">
        <span class="globe-overlay-accent text-lg font-bold">{{ visitedCount }}</span>
        visited
        <template v-if="layoverCount">
          <span class="mx-1 opacity-40">&middot;</span>
          <span class="globe-layover-accent text-lg font-bold">{{ layoverCount }}</span>
          layover
        </template>
        <template v-if="wantCount">
          <span class="mx-1 opacity-40">&middot;</span>
          <span class="globe-want-accent text-lg font-bold">{{ wantCount }}</span>
          wishlist
        </template>
      </p>
    </div>
  </div>
</template>

<style scoped>
/* ── Container ────────────────────────────────────── */
.globe-container {
  border: 1px solid var(--map-overlay-border, rgba(32, 33, 36, 0.08));
  background: var(--map-ocean, #aadaff);
}
/* Plain `.dark` ancestor, not :global(.dark): Vue compiles `:global(.dark) .x`
   to a bare `.dark`, which drops the descendant and styles <html> instead. */
.dark .globe-container {
  border-color: #3c3d42;
  background: #1f2023;
}

/* ── Tooltip ──────────────────────────────────────── */
.globe-tooltip {
  background: var(--map-tooltip-bg, #202124);
  color: var(--map-tooltip-text, #f8f9fa);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.4;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.25),
    0 1px 4px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(8px);
}
.dark .globe-tooltip {
  background: #2a2b2f;
  color: #e8eaed;
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.5),
    0 1px 4px rgba(0, 0, 0, 0.3);
}

.globe-tooltip-name {
  font-weight: 600;
  font-size: 13px;
  letter-spacing: -0.01em;
}

.globe-tooltip-status {
  margin-top: 2px;
  opacity: 0.6;
  font-size: 11px;
}

.globe-tooltip-visa {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

/* The tooltip is a dark surface in both themes, so one light set reads on it. */
.globe-visa-free {
  background: rgba(124, 196, 154, 0.2);
  color: #81c995;
}
.globe-visa-arrival {
  background: rgba(142, 170, 211, 0.2);
  color: #8ab4f8;
}
.globe-visa-evisa {
  background: rgba(217, 178, 106, 0.2);
  color: #fdd663;
}
.globe-visa-required {
  background: rgba(224, 144, 127, 0.2);
  color: #f28b82;
}

/* Tooltip transition */
.globe-tooltip-enter-active {
  transition: all 0.15s ease-out;
}
.globe-tooltip-leave-active {
  transition: all 0.1s ease-in;
}
.globe-tooltip-enter-from,
.globe-tooltip-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.96);
}

/* ── Overlay (stats) ──────────────────────────────── */
.globe-overlay {
  background: var(--map-overlay-bg, rgba(255, 255, 255, 0.92));
  border: 1px solid var(--map-overlay-border, rgba(32, 33, 36, 0.08));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(12px);
}
.dark .globe-overlay {
  background: rgba(42, 43, 47, 0.92);
  border-color: rgba(220, 229, 230, 0.1);
}

.globe-overlay-text {
  color: var(--map-overlay-text, #202124);
}
.dark .globe-overlay-text {
  color: #e8eaed;
}

.globe-overlay-accent {
  color: var(--map-overlay-accent, #d93025);
}
.dark .globe-overlay-accent {
  color: #f28b82;
}

.globe-layover-accent {
  color: var(--map-layover-accent-color, #1a73e8);
}
.dark .globe-layover-accent {
  color: #8ab4f8;
}

.globe-want-accent {
  color: var(--map-want-accent-color, #188038);
}
.dark .globe-want-accent {
  color: #81c995;
}

/* ── Button ───────────────────────────────────────── */
.globe-btn {
  background: var(--map-btn-bg, rgba(255, 255, 255, 0.82));
  color: var(--map-btn-text, #3c4043);
  backdrop-filter: blur(8px);
}
.globe-btn:hover {
  background: var(--map-btn-hover, rgba(255, 255, 255, 1));
}
.dark .globe-btn {
  background: rgba(42, 43, 47, 0.9);
  color: #e8eaed;
}
.dark .globe-btn:hover {
  background: rgba(44, 58, 62, 0.96);
}
</style>
