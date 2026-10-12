/**
 * Colours shared by every map the app draws itself (2D scratch map, both
 * globes), so they all read like one Google Maps basemap: light-blue water,
 * pale land, quiet grey borders.
 */
export const MAP_PALETTE = {
  light: {
    water: "#aadaff",
    land: "#f8f9fa",
    landHover: "#ffffff",
    border: "#c4c7c5",
    visited: "#ea4335",
    layover: "#4285f4",
    want: "#34a853",
    route: "#1a73e8",
  },
  dark: {
    water: "#1f3639",
    land: "#3c3d42",
    landHover: "#4a4c52",
    border: "#5f6368",
    visited: "#f28b82",
    layover: "#8ab4f8",
    want: "#81c995",
    route: "#8ab4f8",
  },
} as const

export type MapPalette = (typeof MAP_PALETTE)["light"] | (typeof MAP_PALETTE)["dark"]

export function mapPalette(isDark: boolean): MapPalette {
  return isDark ? MAP_PALETTE.dark : MAP_PALETTE.light
}
