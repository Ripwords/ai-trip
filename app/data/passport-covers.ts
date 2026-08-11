/**
 * Stylised passport cover designs.
 *
 * These are approximations, not reproductions. Real covers carry national
 * coats of arms that are government-copyrighted and not licensable for use
 * here, so PassportCover.vue draws a neutral embossed medallion in place of
 * the emblem. What we do model is everything else that makes a cover
 * recognisable: cover colour, foil colour, the supranational line above the
 * country name, and the local-language word for "passport".
 *
 * Entries below are curated. Anything absent falls back to DEFAULT_DESIGN
 * (navy with gold, the most common combination worldwide) — add a row to
 * correct any country.
 */

export type PassportFoil = "gold" | "silver" | "black" | "white"

export interface PassportCoverDesign {
  /** Cover colour. */
  cover: string
  foil: PassportFoil
  /** Line printed above the country name, e.g. "EUROPEAN UNION". */
  supra?: string
  /**
   * Formal title as printed on the real cover, when it differs from the
   * country-list name ("REPUBLIC OF KOREA", not "Korea, South").
   */
  title?: string
  /** Local-language word for "passport", printed under the English one. */
  localWord?: string
  /** Draws the ICAO e-passport chip symbol. */
  biometric: boolean
}

export const FOIL_COLORS: Record<PassportFoil, string> = {
  gold: "#c9a227",
  silver: "#c5c9ce",
  black: "#1b1b1b",
  white: "#f2efe8",
}

const BURGUNDY = "#6d1f2b"
const NAVY = "#16264a"
const DEEP_BLUE = "#1b3a6b"
const FOREST = "#12452a"
const DEEP_RED = "#7d1a24"
const BLACK = "#15161a"

export const DEFAULT_DESIGN: PassportCoverDesign = {
  cover: NAVY,
  foil: "gold",
  biometric: true,
}

/** EU ordinary passports are burgundy-red — Croatia is the sole exception. */
const EU_BURGUNDY: PassportCoverDesign = {
  cover: BURGUNDY,
  foil: "gold",
  supra: "EUROPEAN UNION",
  biometric: true,
}

/** Andean Community covers are bordeaux with gold lettering. */
const ANDEAN: PassportCoverDesign = {
  cover: "#5f1d2a",
  foil: "gold",
  supra: "COMUNIDAD ANDINA",
  localWord: "PASAPORTE",
  biometric: true,
}

/** CA-4 covers are navy blue and carry the América Central line. */
const CA4: PassportCoverDesign = {
  cover: NAVY,
  foil: "gold",
  supra: "AMÉRICA CENTRAL",
  localWord: "PASAPORTE",
  biometric: true,
}

/** Mercosur covers are navy with the bloc name above the country. */
const MERCOSUR: PassportCoverDesign = {
  cover: NAVY,
  foil: "gold",
  supra: "MERCOSUR",
  localWord: "PASAPORTE",
  biometric: true,
}

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

/** Local-language wording for EU members, applied over the burgundy base. */
const EU_LOCAL_WORD: Partial<Record<string, string>> = {
  FR: "PASSEPORT",
  DE: "REISEPASS",
  AT: "REISEPASS",
  ES: "PASAPORTE",
  IT: "PASSAPORTO",
  PT: "PASSAPORTE",
  NL: "PASPOORT",
  BE: "PASPOORT",
  PL: "PASZPORT",
  SE: "PASS",
  DK: "PAS",
  FI: "PASSI",
  GR: "ΔΙΑΒΑΤΗΡΙΟ",
  CZ: "CESTOVNÍ PAS",
  HU: "ÚTLEVÉL",
  RO: "PAȘAPORT",
  BG: "ПАСПОРТ",
  IE: "PAS",
  LT: "PASAS",
  LV: "PASE",
  EE: "PASS",
  SK: "CESTOVNÝ PAS",
  SI: "POTNI LIST",
  MT: "PASSAPORT",
  LU: "PASSEPORT",
  CY: "ΔΙΑΒΑΤΗΡΙΟ",
}

const CURATED: Record<string, PassportCoverDesign> = {
  // Croatia is the documented exception to the EU burgundy standard.
  HR: {
    cover: DEEP_BLUE,
    foil: "gold",
    supra: "EUROPEAN UNION",
    localWord: "PUTOVNICA",
    biometric: true,
  },

  // Andean Community
  BO: ANDEAN,
  CO: ANDEAN,
  EC: ANDEAN,
  PE: ANDEAN,

  // CA-4
  GT: CA4,
  SV: CA4,
  HN: CA4,
  NI: CA4,

  // Mercosur
  AR: MERCOSUR,
  UY: MERCOSUR,
  PY: MERCOSUR,
  BR: {
    ...MERCOSUR,
    title: "REPÚBLICA FEDERATIVA DO BRASIL",
    supra: "MERCOSUL",
    localWord: "PASSAPORTE",
  },

  // Anglosphere
  US: { title: "UNITED STATES OF AMERICA", cover: NAVY, foil: "gold", biometric: true },
  GB: { cover: "#1a2c50", foil: "gold", biometric: true },
  CA: { cover: NAVY, foil: "gold", localWord: "PASSEPORT", biometric: true },
  AU: { cover: NAVY, foil: "gold", biometric: true },
  NZ: { cover: BLACK, foil: "silver", localWord: "URUWHENUA", biometric: true },

  // Asia
  JP: { cover: DEEP_RED, foil: "gold", localWord: "旅券", biometric: true },
  CN: {
    title: "PEOPLE'S REPUBLIC OF CHINA",
    cover: "#7a1420",
    foil: "gold",
    localWord: "护照",
    biometric: true,
  },
  KR: { title: "REPUBLIC OF KOREA", cover: NAVY, foil: "gold", localWord: "여권", biometric: true },
  IN: {
    title: "REPUBLIC OF INDIA",
    cover: NAVY,
    foil: "gold",
    localWord: "पासपोर्ट",
    biometric: true,
  },
  SG: { cover: "#8a1425", foil: "gold", biometric: true },
  MY: { cover: NAVY, foil: "gold", localWord: "PASPORT", biometric: true },
  TH: { cover: DEEP_RED, foil: "gold", localWord: "หนังสือเดินทาง", biometric: true },
  ID: {
    title: "REPUBLIK INDONESIA",
    cover: DEEP_RED,
    foil: "gold",
    localWord: "PASPOR",
    biometric: true,
  },
  VN: {
    title: "SOCIALIST REPUBLIC OF VIET NAM",
    cover: FOREST,
    foil: "gold",
    localWord: "HỘ CHIẾU",
    biometric: true,
  },
  PH: {
    title: "REPUBLIC OF THE PHILIPPINES",
    cover: "#5e1a2b",
    foil: "gold",
    localWord: "PASAPORTE",
    biometric: true,
  },
  PK: { title: "ISLAMIC REPUBLIC OF PAKISTAN", cover: FOREST, foil: "gold", biometric: true },
  BD: {
    title: "PEOPLE'S REPUBLIC OF BANGLADESH",
    cover: FOREST,
    foil: "gold",
    localWord: "পাসপোর্ট",
    biometric: true,
  },
  LK: {
    title: "DEMOCRATIC SOCIALIST REPUBLIC OF SRI LANKA",
    cover: FOREST,
    foil: "gold",
    biometric: true,
  },
  NP: {
    title: "FEDERAL DEMOCRATIC REPUBLIC OF NEPAL",
    cover: FOREST,
    foil: "gold",
    biometric: true,
  },
  TW: { cover: NAVY, foil: "gold", localWord: "護照", biometric: true },
  HK: { cover: NAVY, foil: "gold", localWord: "護照", biometric: true },

  // Middle East
  SA: {
    title: "KINGDOM OF SAUDI ARABIA",
    cover: FOREST,
    foil: "gold",
    localWord: "جواز سفر",
    biometric: true,
  },
  AE: {
    title: "UNITED ARAB EMIRATES",
    cover: NAVY,
    foil: "gold",
    localWord: "جواز سفر",
    biometric: true,
  },
  QA: { cover: "#5e1a2b", foil: "gold", localWord: "جواز سفر", biometric: true },
  KW: { cover: NAVY, foil: "gold", localWord: "جواز سفر", biometric: true },
  IL: { cover: NAVY, foil: "gold", localWord: "דרכון", biometric: true },
  TR: {
    title: "TÜRKİYE CUMHURİYETİ",
    cover: BURGUNDY,
    foil: "gold",
    localWord: "PASAPORT",
    biometric: true,
  },

  // Europe (non-EU)
  CH: {
    title: "CONFOEDERATIO HELVETICA",
    cover: "#8e1b22",
    foil: "silver",
    localWord: "PASSEPORT",
    biometric: true,
  },
  IS: { cover: BURGUNDY, foil: "gold", localWord: "VEGABRÉF", biometric: true },
  RU: {
    title: "РОССИЙСКАЯ ФЕДЕРАЦИЯ",
    cover: "#6e1420",
    foil: "gold",
    localWord: "ПАСПОРТ",
    biometric: true,
  },
  UA: { cover: NAVY, foil: "gold", localWord: "ПАСПОРТ", biometric: true },

  // Africa
  ZA: { title: "REPUBLIC OF SOUTH AFRICA", cover: FOREST, foil: "gold", biometric: true },
  NG: { title: "FEDERAL REPUBLIC OF NIGERIA", cover: FOREST, foil: "gold", biometric: true },
  KE: {
    title: "REPUBLIC OF KENYA",
    cover: DEEP_BLUE,
    foil: "gold",
    supra: "EAST AFRICAN COMMUNITY",
    biometric: true,
  },
  EG: {
    title: "ARAB REPUBLIC OF EGYPT",
    cover: NAVY,
    foil: "gold",
    localWord: "جواز سفر",
    biometric: true,
  },
  MA: { cover: DEEP_RED, foil: "gold", localWord: "جواز سفر", biometric: true },
  GH: { cover: "#5e1a2b", foil: "gold", biometric: true },
  ET: { cover: FOREST, foil: "gold", biometric: true },
  TZ: {
    title: "UNITED REPUBLIC OF TANZANIA",
    cover: DEEP_BLUE,
    foil: "gold",
    supra: "EAST AFRICAN COMMUNITY",
    biometric: true,
  },

  // Americas
  MX: {
    title: "ESTADOS UNIDOS MEXICANOS",
    cover: FOREST,
    foil: "gold",
    localWord: "PASAPORTE",
    biometric: true,
  },
  CL: { cover: NAVY, foil: "gold", localWord: "PASAPORTE", biometric: true },
  CU: { cover: "#5e1a2b", foil: "gold", localWord: "PASAPORTE", biometric: true },
  CR: { cover: DEEP_BLUE, foil: "gold", localWord: "PASAPORTE", biometric: true },
  PA: { cover: NAVY, foil: "gold", localWord: "PASAPORTE", biometric: true },
}

const DESIGNS: Record<string, PassportCoverDesign> = (() => {
  const table: Record<string, PassportCoverDesign> = {}
  for (const code of EU_MEMBERS) {
    const localWord = EU_LOCAL_WORD[code]
    table[code] = localWord ? { ...EU_BURGUNDY, localWord } : EU_BURGUNDY
  }
  return { ...table, ...CURATED }
})()

/** Number of countries with a hand-checked design rather than the fallback. */
export const CURATED_COVER_COUNT = Object.keys(DESIGNS).length

export function passportCoverDesign(countryCode: string): PassportCoverDesign {
  return DESIGNS[countryCode.toUpperCase()] ?? DEFAULT_DESIGN
}

export function hasCuratedCover(countryCode: string): boolean {
  return countryCode.toUpperCase() in DESIGNS
}
