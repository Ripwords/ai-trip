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
// Real-world ICAO airline designators number well under 1,000. Capping the
// batch protects against an adversarial CSV that lists tens of thousands of
// fake 3-letter codes — keeps the outbound POST body small and bounded.
const MAX_CODES_PER_LOOKUP = 500
// Cap on the SPARQL response body before we attempt to parse it. A bounded
// payload defends against a compromised endpoint or MITM that tries to
// exhaust memory with an arbitrarily large body. Real responses are < 50 KB.
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

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
  ).slice(0, MAX_CODES_PER_LOOKUP)
  if (icaoCodes.length === 0) return new Map()

  const values = icaoCodes.map((c) => `"${c}"`).join(" ")
  const query = `SELECT ?icao ?iata WHERE { VALUES ?icao { ${values} } ?airline wdt:P230 ?icao ; wdt:P229 ?iata . }`

  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = options.endpoint ?? SPARQL_ENDPOINT
  const userAgent =
    options.userAgent ?? "ai-trip-flighty-import/1.0 (https://github.com; flight-import)"

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    // POST (form-encoded) is Wikidata's recommended verb for any SPARQL body
    // larger than trivial. Eliminates the GET URL-length concern for batches
    // of up to MAX_CODES_PER_LOOKUP codes.
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body: `query=${encodeURIComponent(query)}&format=json`,
      signal: controller.signal,
    })
    if (!res.ok) {
      console.warn(`Wikidata lookup returned ${res.status}; skipping ICAO conversion`)
      return new Map()
    }
    const declared = Number(res.headers.get("content-length") ?? 0)
    if (declared > MAX_RESPONSE_BYTES) {
      console.warn(`Wikidata response too large (${declared} bytes); skipping conversion`)
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
