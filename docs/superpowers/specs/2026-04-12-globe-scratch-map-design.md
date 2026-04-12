# Globe Scratch Map — 3D View for Explore Page

## Overview

Add a 3D interactive globe view to the explore page as an alternative to the existing 2D scratch map. Users toggle between views via a button in the zoom controls. The globe renders filled, clickable country meshes colored by visit status, with the same interactions as the 2D map: click to open the detail panel, hover for tooltips (desktop only), zoom, and rotate.

## Component Architecture

```
explore.vue
├── viewMode ref ("2d" | "3d"), persisted in localStorage
├── <ScratchMap>        (v-if="viewMode === '2d'")
│   └── existing SVG map + new globe toggle button in controls
├── <GlobeScratchMap>   (v-else)
│   └── TresJS globe with triangulated country meshes
├── <CountryDetailPanel>  (shared, unchanged)
└── <VisaChecker>         (shared, unchanged)
```

### Props & Events Contract

Both `ScratchMap` and `GlobeScratchMap` share the same interface:

```ts
// Props
visitMap: Map<string, VisitType>
visaStatusMap: Record<string, { visaStatus: string; maxStayDays: number | null }>

// Emits
countryClick: [country: CountryInfo]
toggleView: []
```

### Toggle Button

- In `ScratchMap`: globe icon (`lucide:globe`) added to zoom controls area — emits `toggleView`
- In `GlobeScratchMap`: map icon (`lucide:map`) added to controls area — emits `toggleView`
- `explore.vue` handles `toggleView` by flipping `viewMode` and persisting to `localStorage`

## Globe Rendering

### Country Meshes via Triangulated GeoJSON

1. **Parse**: `topojson-client` converts `countries-50m.json` to GeoJSON features (same source as 2D map)
2. **Project**: Convert each polygon's lat/lng coordinates to 3D positions on the sphere via `latLngToVector3`
3. **Triangulate**: Use `earcut` library to triangulate each polygon into triangle faces, creating `BufferGeometry` with vertices and indices
4. **Material**: Each country gets a `MeshPhongMaterial` colored by visit status

### Color Mapping (matching 2D map)

| Status          | Light Mode          | Dark Mode                |
| --------------- | ------------------- | ------------------------ |
| Visited         | terra-400 `#f07b5a` | terra-400 dark `#d44425` |
| Layover         | ocean-400 `#4aa5b9` | ocean-400 dark `#2e8a9e` |
| Want to visit   | `#a78bfa`           | `#8b5cf6`                |
| Unvisited       | sand-200 `#e8e0d4`  | sand-200 dark `#302b24`  |
| Hover highlight | Brighten emissive   | Brighten emissive        |

### Performance Optimization

- **Merge unvisited countries** into a single `BufferGeometry` (one draw call for ~170 countries)
- **Individual meshes** only for marked countries (visited/layover/want — typically < 30)
- Store a **face-to-country lookup** array on the merged mesh: each triangle maps to a country ID, so click events can resolve which country was hit via the intersection's face index
- When visit status changes, rebuild the merged geometry reactively

### Visual Layers

1. **Ocean sphere**: `MeshPhongMaterial`, theme-aware (dark warm tone / light blue tone)
2. **Country meshes**: filled polygons colored by status (merged + individual)
3. **Country borders**: `LineSegments` slightly elevated above meshes to prevent z-fighting, using existing TopoJSON border line geometry
4. **Atmosphere rim**: slightly larger transparent sphere for edge glow

### Light/Dark Theme

Same pattern as `FlightGlobe.vue` — `useDarkMode()` composable with a computed theme object. Colors derived from the app's sand/terra/ocean/forest design tokens.

## Interactions

### Click

- Each marked country mesh: TresJS `@click` event → emits `countryClick` with `CountryInfo`
- Merged unvisited mesh: `@click` event → resolve country from face index lookup → emit `countryClick`
- After click: smooth auto-center animation (rotate globe to face the clicked country over ~500ms)
- Opens the same `CountryDetailPanel` sidebar/bottom sheet as the 2D map

### Auto-Center on Click

1. Compute centroid of clicked country's polygon (average lat/lng)
2. Convert centroid to a 3D direction vector
3. Animate camera position along that direction at current zoom distance
4. Use `requestAnimationFrame` lerp over ~500ms for smooth transition

### Hover (Desktop Only)

- Detect touch device via `window.matchMedia('(pointer: coarse)')`
- `@pointer-over` / `@pointer-out` on country meshes
- On hover: brighten material emissive color for highlight effect
- Show HTML tooltip overlay:
  - Position: project raycasting intersection point to screen coordinates via `Vector3.project(camera)`
  - Content: country name, visit status label, visa status badge (same as 2D tooltip)
- On pointer-out: restore material, hide tooltip

### Rotate + Zoom

- `OrbitControls` with:
  - `enableZoom: true` (scroll to zoom)
  - `enablePan: false`
  - `autoRotate: false` (interactive map, not decorative)
  - `minDistance: 3` (zoomed in)
  - `maxDistance: 8` (fully zoomed out)
  - Damping enabled for smooth feel

### Stats Overlay

- Same bottom-left stats as 2D map: visited count, layover count, wishlist count
- HTML overlay on top of the canvas

### Fullscreen

- Same fullscreen toggle as 2D map (top-left button)
- Toggles body overflow, resizes canvas

## New Dependencies

- `earcut` — polygon triangulation (small, no dependencies, widely used)

## Files

### New

| File                                 | Responsibility                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `app/components/GlobeScratchMap.vue` | TresJS 3D globe with clickable country meshes                                 |
| `app/utils/globe-countries.ts`       | Triangulation logic: GeoJSON → sphere mesh geometries, face-to-country lookup |

### Modified

| File                            | Change                                                        |
| ------------------------------- | ------------------------------------------------------------- |
| `app/pages/explore.vue`         | Add `viewMode` toggle, render `GlobeScratchMap` conditionally |
| `app/components/ScratchMap.vue` | Add globe toggle button to zoom controls, emit `toggleView`   |
| `package.json`                  | Add `earcut` dependency                                       |

### No Backend Changes

The globe consumes the exact same APIs as the 2D map. No new endpoints, no schema changes.
