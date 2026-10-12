import type { Vector3 } from "three"
import { latLngToVector3 } from "./globe-countries"

interface LatLng {
  lat: number
  lng: number
}

/**
 * Points along the great circle from `a` to `b`, lifted into a gentle arc that
 * leaves and lands on the surface and never cuts into the globe.
 */
export function greatCircleArc(a: LatLng, b: LatLng, radius: number, segments: number): Vector3[] {
  const from = latLngToVector3(a.lat, a.lng, 1)
  const to = latLngToVector3(b.lat, b.lng, 1)
  const angle = from.angleTo(to)
  // Longer routes fly higher, as on a flight map; capped so they stay on screen.
  const lift = radius * Math.min(0.25, angle * 0.12)

  const points: Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const dir =
      angle < 1e-6
        ? from.clone()
        : from
            .clone()
            .multiplyScalar(Math.sin((1 - t) * angle))
            .add(to.clone().multiplyScalar(Math.sin(t * angle)))
            .divideScalar(Math.sin(angle))
    points.push(dir.normalize().multiplyScalar(radius + lift * Math.sin(Math.PI * t)))
  }
  return points
}
