/**
 * Maps country names (as used in the Passport Index Dataset) to ISO alpha-2 codes.
 * Only includes entries where the dataset name differs from the canonical name
 * in app/data/countries.ts — exact matches are handled by the reverse lookup.
 */
const DATASET_NAME_OVERRIDES: Record<string, string> = {
  "Cape Verde": "CV",
  "Congo": "CG",
  "DR Congo": "CD",
  "Ivory Coast": "CI",
  "Kosovo": "XK",
  "Macao": "MO",
  "North Korea": "KP",
  "Sao Tome and Principe": "ST",
  "South Korea": "KR",
  "Swaziland": "SZ",
  "Vatican": "VA",
}

// Build reverse lookup: name → alpha-2 from the canonical countries list.
// We import the raw array to avoid pulling in client-side Map utilities.
import { countries } from "../../app/data/countries"

const nameToAlpha2 = new Map<string, string>()

// Add canonical names (case-insensitive key)
for (const c of countries) {
  nameToAlpha2.set(c.name.toLowerCase(), c.alpha2)
}

// Add dataset-specific overrides
for (const [name, code] of Object.entries(DATASET_NAME_OVERRIDES)) {
  nameToAlpha2.set(name.toLowerCase(), code)
}

/**
 * Convert a country name to its ISO alpha-2 code.
 * Returns the input unchanged if it's already a 2-letter code.
 * Returns undefined if no mapping is found.
 */
export function countryNameToAlpha2(name: string): string | undefined {
  // Already an alpha-2 code
  if (name.length === 2 && name === name.toUpperCase()) {
    return name
  }

  return nameToAlpha2.get(name.toLowerCase())
}
