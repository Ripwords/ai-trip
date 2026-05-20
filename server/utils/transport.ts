export const transportModes = ["driving", "walking", "transit", "bicycling"] as const

export type TransportMode = (typeof transportModes)[number]

export const transportModeLabels: Record<TransportMode, string> = {
  driving: "Drive / taxi",
  walking: "Walk",
  transit: "Transit",
  bicycling: "Bike",
}

export function normalizeTransportMode(value: unknown): TransportMode {
  return typeof value === "string" && transportModes.includes(value as TransportMode)
    ? (value as TransportMode)
    : "driving"
}
