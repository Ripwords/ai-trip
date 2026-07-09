<script setup lang="ts">
import { OrbitControls } from "@tresjs/cientos"
import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
  SphereGeometry,
  Mesh,
  Raycaster,
  Vector2,
  CanvasTexture,
  SRGBColorSpace,
  Color,
} from "three"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import worldTopoJson from "../data/countries-50m.json"
import { countryByNumeric, type CountryInfo } from "../data/countries"
import {
  getCountryFeatures,
  getCountryCentroid,
  latLngToVector3,
  GLOBE_RADIUS,
  type VisitType,
} from "../utils/globe-countries"
import { geoEquirectangular, geoPath } from "d3-geo"

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

// --- Theme: mirrors 2D ScratchMap color tokens exactly ---
const theme = computed(() =>
  isDark.value
    ? {
        clearColor: "#1a1714",
        oceanColor: "#1e3050",
        landColor: "#3d7a4a",
        visitedColor: "#f07b5a",
        layoverColor: "#4aa5b9",
        wantColor: "#8b5cf6",
        borderColor: "#2a5040",
        borderOpacity: 0.7,
        atmosphere: "#4a8ab5",
        atmosphereOpacity: 0.04,
        overlayBg: "rgba(10, 15, 26, 0.92)",
        overlayBorder: "rgba(255, 255, 255, 0.1)",
        overlayText: "#c8d6e5",
        overlayAccent: "#f07b5a",
        layoverAccent: "#7dc3d4",
        wantAccent: "#a78bfa",
        btnBg: "rgba(20, 40, 60, 0.85)",
        btnText: "#c8d6e5",
        btnHover: "rgba(30, 55, 80, 0.95)",
        tooltipBg: "#162840",
        tooltipText: "#e2e8f0",
        tooltipBadgeBg: "rgba(255, 255, 255, 0.12)",
      }
    : {
        clearColor: "#faf8f5",
        oceanColor: "#2a4f72",
        landColor: "#7aab7e",
        visitedColor: "#f07b5a",
        layoverColor: "#7dc3d4",
        wantColor: "#a78bfa",
        borderColor: "#4a8060",
        borderOpacity: 0.4,
        atmosphere: "#6ab0d0",
        atmosphereOpacity: 0.06,
        overlayBg: "rgba(255, 255, 255, 0.92)",
        overlayBorder: "rgba(0, 0, 0, 0.1)",
        overlayText: "#1a3a5c",
        overlayAccent: "#d44425",
        layoverAccent: "#2e8a9e",
        wantAccent: "#7c3aed",
        btnBg: "rgba(255, 255, 255, 0.85)",
        btnText: "#1a3a5c",
        btnHover: "rgba(255, 255, 255, 1)",
        tooltipBg: "#1a3a5c",
        tooltipText: "#f0f4f8",
        tooltipBadgeBg: "rgba(255, 255, 255, 0.15)",
      },
)

// --- Parse TopoJSON ---
const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

// --- Build country border lines as 3D geometry ---
function buildBorderLines(): LineSegments {
  const vertices: number[] = []

  for (const feat of countriesGeo.features) {
    const coords =
      feat.geometry.type === "Polygon"
        ? [feat.geometry.coordinates]
        : feat.geometry.type === "MultiPolygon"
          ? feat.geometry.coordinates
          : []

    for (const polygon of coords) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [lng1, lat1] = ring[i]!
          const [lng2, lat2] = ring[i + 1]!
          if (Math.abs(lat1!) > 85 && Math.abs(lat2!) > 85) continue
          const v1 = latLngToVector3(lat1!, lng1!, GLOBE_RADIUS * 1.001)
          const v2 = latLngToVector3(lat2!, lng2!, GLOBE_RADIUS * 1.001)
          vertices.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
        }
      }
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute("position", new Float32BufferAttribute(vertices, 3))

  const mat = new LineBasicMaterial({
    color: new Color(theme.value.borderColor),
    transparent: true,
    opacity: theme.value.borderOpacity,
  })

  return new LineSegments(geo, mat)
}

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

// --- Globe color texture (ocean + land + visited status) ---
function renderGlobeTexture(): CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = TEX_WIDTH
  canvas.height = TEX_HEIGHT
  const ctx = canvas.getContext("2d")!
  const t = theme.value

  ctx.fillStyle = t.oceanColor
  ctx.fillRect(0, 0, TEX_WIDTH, TEX_HEIGHT)

  // Draw each country with visit-status coloring
  for (const feat of allFeatures) {
    const alpha2 = feat.info?.alpha2
    const visitType = alpha2 ? props.visitMap.get(alpha2) : undefined

    if (visitType === "visited") ctx.fillStyle = t.visitedColor
    else if (visitType === "layover") ctx.fillStyle = t.layoverColor
    else if (visitType === "want_to_visit") ctx.fillStyle = t.wantColor
    else ctx.fillStyle = t.landColor

    ctx.beginPath()
    pathGenerator.context(ctx)(feat.geoFeature)
    ctx.fill()
  }

  // Borders on top
  ctx.strokeStyle = t.borderColor
  ctx.lineWidth = 1.2
  for (const feat of allFeatures) {
    ctx.beginPath()
    pathGenerator.context(ctx)(feat.geoFeature)
    ctx.stroke()
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

// --- Globe mesh ---
const globeGeo = new SphereGeometry(GLOBE_RADIUS, 64, 64)
const globeMat = new MeshBasicMaterial()
const globeMesh = new Mesh(globeGeo, globeMat)

const borderLines = buildBorderLines()

let idCanvas: HTMLCanvasElement | null = null

onMounted(() => {
  idCanvas = renderIdTexture()
  globeMat.map = renderGlobeTexture()
  globeMat.needsUpdate = true
})

// Update when visitMap or theme changes
watch([() => props.visitMap, theme], () => {
  globeMat.map = renderGlobeTexture()
  globeMat.needsUpdate = true
  ;(borderLines.material as LineBasicMaterial).color.set(theme.value.borderColor)
  ;(borderLines.material as LineBasicMaterial).opacity = theme.value.borderOpacity
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
  const hits = raycaster.intersectObject(globeMesh)
  const nearest = hits[0]
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

// --- Auto-center animation ---
const countryFeatures = getCountryFeatures()

function animateToCentroid(info: CountryInfo) {
  const feat = countryFeatures.find((f) => f.info?.alpha2 === info.alpha2)
  if (!feat) return

  const centroid = getCountryCentroid(feat)
  const target = latLngToVector3(centroid.lat, centroid.lng, 0)
  const cameraTarget = latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS)
    .normalize()
    .multiplyScalar(5)

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
        <TresPerspectiveCamera :position="[-1.03, 0.37, -4.89]" :fov="45" />

        <OrbitControls
          ref="controlsRef"
          :enable-zoom="true"
          :enable-pan="false"
          :auto-rotate="false"
          :min-distance="2.5"
          :max-distance="8"
          :enable-damping="true"
        />

        <!-- Globe with land/ocean/visited texture -->
        <primitive :object="globeMesh" />

        <!-- Country borders -->
        <primitive :object="borderLines" />

        <!-- Atmosphere rim -->
        <TresMesh>
          <TresSphereGeometry :args="[GLOBE_RADIUS * 1.015, 64, 64]" />
          <TresMeshBasicMaterial
            :color="theme.atmosphere"
            :transparent="true"
            :opacity="theme.atmosphereOpacity"
            :side="1"
          />
        </TresMesh>
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
  border: 1px solid var(--map-overlay-border, rgba(0, 0, 0, 0.08));
  background: var(--map-ocean, #dceef5);
}
:global(.dark) .globe-container {
  border-color: #1e3044;
  background: #0c1524;
}

/* ── Tooltip ──────────────────────────────────────── */
.globe-tooltip {
  background: var(--map-tooltip-bg, #3d3328);
  color: var(--map-tooltip-text, #faf8f5);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.4;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.25),
    0 1px 4px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(8px);
}
:global(.dark) .globe-tooltip {
  background: #1e3044;
  color: #e2e8f0;
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

.globe-visa-free {
  background: rgba(74, 222, 128, 0.2);
  color: #22c55e;
}
.globe-visa-arrival {
  background: rgba(96, 165, 250, 0.2);
  color: #3b82f6;
}
.globe-visa-evisa {
  background: rgba(251, 191, 36, 0.2);
  color: #d97706;
}
.globe-visa-required {
  background: rgba(248, 113, 113, 0.2);
  color: #ef4444;
}

:global(.dark) .globe-visa-free {
  color: #86efac;
}
:global(.dark) .globe-visa-arrival {
  color: #93c5fd;
}
:global(.dark) .globe-visa-evisa {
  color: #fcd34d;
}
:global(.dark) .globe-visa-required {
  color: #fca5a5;
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
  border: 1px solid var(--map-overlay-border, rgba(0, 0, 0, 0.08));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(12px);
}
:global(.dark) .globe-overlay {
  background: rgba(12, 21, 36, 0.92);
  border-color: rgba(255, 255, 255, 0.1);
}

.globe-overlay-text {
  color: var(--map-overlay-text, #3d3328);
}
:global(.dark) .globe-overlay-text {
  color: #c8d6e5;
}

.globe-overlay-accent {
  color: var(--map-overlay-accent, #d44425);
}
:global(.dark) .globe-overlay-accent {
  color: #f07b5a;
}

.globe-layover-accent {
  color: var(--map-layover-accent-color, #2e8a9e);
}
:global(.dark) .globe-layover-accent {
  color: #7dc3d4;
}

.globe-want-accent {
  color: var(--map-want-accent-color, #7c3aed);
}
:global(.dark) .globe-want-accent {
  color: #a78bfa;
}

/* ── Button ───────────────────────────────────────── */
.globe-btn {
  background: var(--map-btn-bg, rgba(255, 255, 255, 0.82));
  color: var(--map-btn-text, #5a4b3a);
  backdrop-filter: blur(8px);
}
.globe-btn:hover {
  background: var(--map-btn-hover, rgba(255, 255, 255, 1));
}
:global(.dark) .globe-btn {
  background: rgba(30, 48, 68, 0.85);
  color: #c8d6e5;
}
:global(.dark) .globe-btn:hover {
  background: rgba(42, 68, 96, 0.95);
}
</style>
