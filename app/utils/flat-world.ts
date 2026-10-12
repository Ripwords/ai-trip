import { geoEquirectangular, geoPath } from "d3-geo"
import type { Feature, Geometry } from "geojson"
import type { MapPalette } from "./map-palette"

export interface WorldCountry {
  /** Zero-padded ISO 3166 numeric code, as in the TopoJSON ids. */
  id: string
  geoFeature: Feature<Geometry>
}

/**
 * Paints the world as a flat equirectangular map (water, land, borders) for
 * wrapping onto a globe. `fillFor` colours individual countries, e.g. visited.
 */
export function drawFlatWorld(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  countries: WorldCountry[],
  palette: MapPalette,
  fillFor?: (id: string) => string | undefined,
) {
  const path = geoPath(
    geoEquirectangular()
      .scale(width / (2 * Math.PI))
      .translate([width / 2, height / 2]),
    ctx,
  )

  ctx.fillStyle = palette.water
  ctx.fillRect(0, 0, width, height)

  for (const country of countries) {
    ctx.beginPath()
    path(country.geoFeature)
    ctx.fillStyle = fillFor?.(country.id) ?? palette.land
    ctx.fill()
  }

  ctx.strokeStyle = palette.border
  ctx.lineWidth = width / 2048
  ctx.lineJoin = "round"
  for (const country of countries) {
    ctx.beginPath()
    path(country.geoFeature)
    ctx.stroke()
  }
}
