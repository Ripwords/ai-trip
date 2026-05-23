/**
 * Batch lookup of ICAO → IATA airline codes via the public Wikidata SPARQL
 * endpoint. No API key required; data is community-maintained.
 *
 * Used at import time to canonicalize Flighty's ICAO codes (e.g. EVA, UAE) into
 * the IATA codes (BR, EK) the rest of the app expects, so cross-format dedupe
 * and 2-letter logo CDNs work.
 *
 * Wikidata properties:
 *   P229 = IATA airline designator
 *   P230 = ICAO airline designator
 *
 * Behavior on failure: returns an empty Map. Callers should treat absence as
 * "no conversion known" and pass the original code through unchanged.
 */

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
const REQUEST_TIMEOUT_MS = 5000

interface SparqlBinding {
  icao: { value: string }
  iata: { value: string }
}

interface SparqlResponse {
  results?: { bindings?: SparqlBinding[] }
}

export interface IcaoLookupOptions {
  /** Override for tests. */
  fetchImpl?: typeof fetch
  /** Override for tests. */
  endpoint?: string
  /** User-Agent header. Wikidata requires a descriptive value. */
  userAgent?: string
}

/**
 * Looks up IATA codes for the given 3-letter ICAO airline codes. Codes that
 * are not 3 letters, that have no IATA match, or that error out are simply
 * absent from the returned Map (callers fall back to the original code).
 */
export async function lookupIcaoToIata(
  codes: string[],
  options: IcaoLookupOptions = {},
): Promise<Map<string, string>> {
  const icaoCodes = Array.from(
    new Set(codes.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c))),
  )
  if (icaoCodes.length === 0) return new Map()

  const values = icaoCodes.map((c) => `"${c}"`).join(" ")
  const query = `SELECT ?icao ?iata WHERE { VALUES ?icao { ${values} } ?airline wdt:P230 ?icao ; wdt:P229 ?iata . }`

  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = options.endpoint ?? SPARQL_ENDPOINT
  const userAgent =
    options.userAgent ?? "ai-trip-flighty-import/1.0 (https://github.com; flight-import)"

  const url = `${endpoint}?query=${encodeURIComponent(query)}&format=json`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetchImpl(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": userAgent,
      },
      signal: controller.signal,
    })
    if (!res.ok) {
      console.warn(`Wikidata lookup returned ${res.status}; skipping ICAO conversion`)
      return new Map()
    }
    const data = (await res.json()) as SparqlResponse
    const bindings = data.results?.bindings ?? []
    const out = new Map<string, string>()
    for (const b of bindings) {
      const icao = b.icao?.value?.toUpperCase()
      const iata = b.iata?.value?.toUpperCase()
      // Some airlines have multiple Wikidata entries; first one wins.
      if (icao && iata && !out.has(icao)) {
        out.set(icao, iata)
      }
    }
    return out
  } catch (err: unknown) {
    console.warn("Wikidata ICAO→IATA lookup failed:", err)
    return new Map()
  } finally {
    clearTimeout(timeout)
  }
}
