/**
 * Colours shared by every map the app draws itself (2D scratch map, both
 * globes), so they all read like one basemap. Light: pale blue water, paper land.
 * Dark: the sea drops to the same warm near-black as the page, so the map
 * reads as a cut-out and only travel status carries colour.
 */
export const MAP_PALETTE = {
  light: {
    water: "#c7dfed",
    land: "#f9f6f2",
    landHover: "#ffffff",
    border: "#c1bdb5",
    visited: "#df784e",
    layover: "#c7ae72",
    want: "#7fb9e1",
    route: "#933603",
  },
  dark: {
    water: "#181410",
    land: "#393632",
    landHover: "#45423d",
    border: "#4e4b46",
    visited: "#e89270",
    layover: "#9c895a",
    want: "#6491b1",
    route: "#f4a98b",
  },
} as const

export type MapPalette = (typeof MAP_PALETTE)["light"] | (typeof MAP_PALETTE)["dark"]

export function mapPalette(isDark: boolean): MapPalette {
  return isDark ? MAP_PALETTE.dark : MAP_PALETTE.light
}
