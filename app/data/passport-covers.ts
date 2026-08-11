/**
 * Cover colours for the illustrated passport booklets in PassportCover.vue.
 *
 * The illustration is deliberately flat — the country's flag carries the
 * identity, so all this table supplies is the booklet colour and whether its
 * lettering reads as light or dark.
 *
 * Entries are curated. Anything absent falls back to DEFAULT_DESIGN (navy,
 * the most common cover colour worldwide) — add a row to correct a country.
 */

export type PassportFoil = "gold" | "silver"

export interface PassportCoverDesign {
  /** Booklet colour. */
  cover: string
  /** Lettering colour on the cover. */
  foil: PassportFoil
}

export const FOIL_COLORS: Record<PassportFoil, string> = {
  gold: "#e0bc5a",
  silver: "#d8dce1",
}

const BURGUNDY = "#7d2733"
const NAVY = "#1d3157"
const DEEP_BLUE = "#23477d"
const FOREST = "#1a5735"
const DEEP_RED = "#8f2430"
const BLACK = "#22242a"

export const DEFAULT_DESIGN: PassportCoverDesign = { cover: NAVY, foil: "gold" }

const GOLD_ON = (cover: string): PassportCoverDesign => ({ cover, foil: "gold" })

/** EU ordinary passports are burgundy-red — Croatia is the sole exception. */
const EU_MEMBERS = [
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const

const CURATED: Record<string, PassportCoverDesign> = {
  // Croatia is the documented exception to the EU burgundy standard.
  HR: GOLD_ON(DEEP_BLUE),

  // Andean Community covers are bordeaux.
  BO: GOLD_ON("#6f2130"),
  CO: GOLD_ON("#6f2130"),
  EC: GOLD_ON("#6f2130"),
  PE: GOLD_ON("#6f2130"),

  // CA-4 and Mercosur covers are navy.
  GT: GOLD_ON(NAVY),
  SV: GOLD_ON(NAVY),
  HN: GOLD_ON(NAVY),
  NI: GOLD_ON(NAVY),
  AR: GOLD_ON(NAVY),
  UY: GOLD_ON(NAVY),
  PY: GOLD_ON(NAVY),
  BR: GOLD_ON(NAVY),

  // Anglosphere
  US: GOLD_ON(NAVY),
  GB: GOLD_ON("#22355e"),
  CA: GOLD_ON(NAVY),
  AU: GOLD_ON(NAVY),
  NZ: { cover: BLACK, foil: "silver" },

  // Asia
  JP: GOLD_ON(DEEP_RED),
  CN: GOLD_ON("#8c1f2a"),
  KR: GOLD_ON(NAVY),
  IN: GOLD_ON(NAVY),
  SG: GOLD_ON("#9b2030"),
  MY: GOLD_ON(NAVY),
  TH: GOLD_ON(DEEP_RED),
  ID: GOLD_ON(DEEP_RED),
  VN: GOLD_ON(FOREST),
  PH: GOLD_ON("#6f2237"),
  PK: GOLD_ON(FOREST),
  BD: GOLD_ON(FOREST),
  LK: GOLD_ON(FOREST),
  NP: GOLD_ON(FOREST),
  TW: GOLD_ON(NAVY),
  HK: GOLD_ON(NAVY),

  // Middle East
  SA: GOLD_ON(FOREST),
  AE: GOLD_ON(NAVY),
  QA: GOLD_ON("#6f2237"),
  KW: GOLD_ON(NAVY),
  IL: GOLD_ON(NAVY),
  TR: GOLD_ON(BURGUNDY),

  // Europe (non-EU)
  CH: { cover: "#a32530", foil: "silver" },
  IS: GOLD_ON(BURGUNDY),
  RU: GOLD_ON("#7f1c28"),
  UA: GOLD_ON(NAVY),

  // Africa
  ZA: GOLD_ON(FOREST),
  NG: GOLD_ON(FOREST),
  KE: GOLD_ON(DEEP_BLUE),
  TZ: GOLD_ON(DEEP_BLUE),
  EG: GOLD_ON(NAVY),
  MA: GOLD_ON(DEEP_RED),
  GH: GOLD_ON("#6f2237"),
  ET: GOLD_ON(FOREST),

  // Americas
  MX: GOLD_ON(FOREST),
  CL: GOLD_ON(NAVY),
  CU: GOLD_ON("#6f2237"),
  CR: GOLD_ON(DEEP_BLUE),
  PA: GOLD_ON(NAVY),
}

const DESIGNS: Record<string, PassportCoverDesign> = (() => {
  const table: Record<string, PassportCoverDesign> = {}
  for (const code of EU_MEMBERS) table[code] = GOLD_ON(BURGUNDY)
  return { ...table, ...CURATED }
})()

/** Number of countries with a hand-checked colour rather than the fallback. */
export const CURATED_COVER_COUNT = Object.keys(DESIGNS).length

export function passportCoverDesign(countryCode: string): PassportCoverDesign {
  return DESIGNS[countryCode.toUpperCase()] ?? DEFAULT_DESIGN
}

export function hasCuratedCover(countryCode: string): boolean {
  return countryCode.toUpperCase() in DESIGNS
}
