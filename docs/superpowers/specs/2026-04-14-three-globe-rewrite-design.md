# Three-Globe Rewrite: Distortion-Free 3D Globe Rendering

## Problem

Both globe components (GlobeScratchMap, FlightGlobe) suffer from polar distortion. GlobeScratchMap renders an equirectangular texture onto a sphere, which stretches country geometry near the poles and creates visual artifacts (border convergence, fill distortion). FlightGlobe draws 3D border lines but lacks filled country geometry.

## Solution

Replace the equirectangular texture approach with `three-globe`, which renders GeoJSON polygons as actual 3D mesh geometry on the sphere surface. Both globes share a common rendering utility.

## Dependencies

- `three-globe` (npm) — returns a `THREE.Object3D` compatible with TresJS `<primitive>`
- Existing: `topojson-client`, `d3-geo` (kept for centroid/utility), `three`

## Architecture

### Shared Utility: `app/utils/globe-renderer.ts`

Factory function that creates and configures a ThreeGlobe instance:

```ts
interface GlobeOptions {
  colors: {
    ocean: string
    atmosphere: string
    atmosphereOpacity: number
    border: string
  }
  polygonColorAccessor: (feat: GeoJSONFeature) => string
  showAtmosphere?: boolean
}

function createGlobe(options: GlobeOptions): ThreeGlobe
```

Responsibilities:

- Parses TopoJSON to GeoJSON features once (reuses existing `countriesGeo`)
- Attaches country info (alpha2, numeric, name) to each feature's properties for raycasting identification
- Calls `globe.polygonsData(features)` with the color accessor
- Configures `globeMaterial()` with ocean color
- Sets `polygonAltitude(0.006)` for slight extrusion above sphere
- Sets `polygonStrokeColor()` for borders
- Configures atmosphere if enabled

### Country Identification

three-globe attaches source data to each polygon mesh via `__data`. When a raycast hit occurs, we read `hit.object.__data` (or walk up parents) to extract the GeoJSON feature and its country alpha2 code.

A helper function is exported:

```ts
function getCountryFromMesh(mesh: THREE.Object3D): CountryInfo | undefined
```

### Theme Switching

All three-globe methods are getter/setters callable at any time. Components watch their theme and call:

- `globe.polygonCapColor(newAccessor)` — recolor polygons
- `globe.polygonSideColor(newAccessor)` — recolor extrusion sides
- `globe.polygonStrokeColor(newAccessor)` — recolor borders
- `globe.globeMaterial(newMaterial)` — change ocean material
- `globe.atmosphereColor(newColor)` — change atmosphere

No globe recreation needed for theme changes.

## Component: GlobeScratchMap.vue

### Rendering

- Creates globe via `createGlobe()` with a color accessor that reads `visitMap`:
  - visited → terra color
  - layover → ocean color
  - want_to_visit → purple
  - unvisited → sand/neutral
- Mounts globe as `<primitive :object="globe" />` inside TresCanvas
- OrbitControls unchanged (zoom 3-8, damping, no pan)

### Click/Hover Detection

- Same manual canvas event listener pattern (MutationObserver to attach after ClientOnly renders canvas)
- Raycaster intersects `globe.children` instead of a single sphere mesh
- Hit mesh → `getCountryFromMesh()` → emit `countryClick` / update tooltip
- Click-vs-drag detection unchanged (5px threshold)

### Visit Status Updates

- When `visitMap` changes, call `globe.polygonCapColor(updatedAccessor)` to recolor
- three-globe handles mesh material updates internally

### Auto-Center Animation

- Same logic using `getCountryCentroid()` and OrbitControls interpolation
- `controlsRef.value?.instance` access pattern unchanged

### Tooltip

- Same behavior: country name, visit type, visa status badge
- Country resolved from mesh hit instead of UV lookup

## Component: FlightGlobe.vue

### Rendering

- Creates globe via `createGlobe()` with subtle muted fill colors (no visit status)
- Mounts globe as `<primitive :object="globe" />`

### Flight Arcs

- Replace manual `QuadraticBezierCurve3` + `Line` with `globe.arcsData()`:
  ```ts
  globe
    .arcsData(arcs)
    .arcStartLat((d) => d.startLat)
    .arcStartLng((d) => d.startLng)
    .arcEndLat((d) => d.endLat)
    .arcEndLng((d) => d.endLng)
    .arcColor(() => theme.arcColor)
    .arcAltitudeAutoScale(0.3)
    .arcStroke(0.5)
  ```

### Airport Dots

- Replace manual `SphereGeometry` dots with `globe.pointsData()`:
  ```ts
  globe
    .pointsData(airports)
    .pointLat((d) => d.lat)
    .pointLng((d) => d.lng)
    .pointColor(() => theme.dotColor)
    .pointRadius(0.4)
    .pointAltitude(0.01)
  ```

### Borders

- Handled by `polygonStrokeColor()` from the shared utility
- Remove `buildCountryLineGeometry()` and `LineSegments` entirely

## Deletions

### From `globe-countries.ts`:

- `renderGlobeTexture()` — replaced by three-globe polygon rendering
- `renderIdTexture()` — replaced by mesh raycasting
- `resolveCountryFromUV()` — no longer needed
- `getFeatureAvgLat()` — no longer needed
- `pathGenerator`, `projection` (equirectangular) — no longer needed
- `TEX_WIDTH`, `TEX_HEIGHT` constants
- `GlobeColors` interface (replaced by new interface in globe-renderer.ts)

### From `FlightGlobe.vue`:

- `buildCountryLineGeometry()` — replaced by three-globe borders
- Manual `QuadraticBezierCurve3` arc construction
- Manual `SphereGeometry` dot construction
- `borderGeometry`, `borderMaterial`, `countryLines`

### Kept in `globe-countries.ts`:

- `latLngToVector3()` — still needed for auto-center animation
- `getCountryCentroid()` — still needed for auto-center
- `getCountryFeatures()` — still needed for feature lookup
- `CountryGeoFeature` interface and `allFeatures`
- `VisitType` type export
- `GLOBE_RADIUS` constant
- TopoJSON parsing (`countriesGeo`, `worldData`)

## Raycasting Details

The current GlobeScratchMap uses a Raycaster against a single sphere mesh and reads UV coordinates to sample an ID texture. The new approach:

1. Canvas click event fires
2. Raycaster set from camera + pointer coordinates (unchanged)
3. Intersect against `globe.children` (recursive) instead of single mesh
4. First hit → walk `object` and parents to find one with `__data` property
5. Extract GeoJSON feature from `__data` → lookup country by numeric ID
6. Emit event / update tooltip

This is simpler and more accurate — no texture encoding/decoding, no UV coordinate flipping.

## Risk: `__data` Property

three-globe's internal data attachment mechanism (`__data`) is not a documented public API. If a future version changes this:

- Mitigation: Pin three-globe version
- Alternative: Use `globe.getPolygons()` if available, or maintain a Map<Mesh, Feature> during polygon creation

## Testing Plan

1. Visual: both globes render countries without polar distortion
2. Interaction: clicking countries opens the sidebar panel (GlobeScratchMap)
3. Interaction: hover tooltip shows country name + visa status
4. Theme: dark/light mode switching updates globe colors
5. Flights: arcs and dots render correctly on FlightGlobe
6. Edge cases: zoom in on north/south pole — no distortion artifacts
7. Performance: globe loads without noticeable delay
