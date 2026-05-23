import { describe, it, expect } from "bun:test"
import { lookupIcaoToIata } from "./icao-to-iata-lookup"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/sparql-results+json" },
  })
}

describe("lookupIcaoToIata", () => {
  it("returns an empty map when given no codes", async () => {
    const calls: string[] = []
    const result = await lookupIcaoToIata([], {
      fetchImpl: async (url) => {
        calls.push(url.toString())
        return jsonResponse({ results: { bindings: [] } })
      },
    })
    expect(result.size).toBe(0)
    expect(calls).toEqual([]) // no network round-trip for empty input
  })

  it("filters out non-ICAO inputs (not 3 uppercase letters)", async () => {
    let body = ""
    await lookupIcaoToIata(["EVA", "BR", "12", "AB", "uae", "Toolong"], {
      fetchImpl: async (_url, init) => {
        body = String(init?.body ?? "")
        return jsonResponse({ results: { bindings: [] } })
      },
    })
    // EVA and uae→UAE survive the filter; the rest are dropped.
    // Body is percent-encoded so check for the encoded quoted token.
    expect(body).toContain("%22EVA%22")
    expect(body).toContain("%22UAE%22")
    expect(body).not.toContain("%22BR%22")
    expect(body).not.toContain("%2212%22")
    expect(body).not.toContain("%22TOOLONG%22")
    expect(body).not.toContain("%22Toolong%22")
  })

  it("dedupes ICAO inputs before querying", async () => {
    let body = ""
    await lookupIcaoToIata(["EVA", "EVA", "EVA"], {
      fetchImpl: async (_url, init) => {
        body = String(init?.body ?? "")
        return jsonResponse({ results: { bindings: [] } })
      },
    })
    expect(body.match(/%22EVA%22/g)!).toHaveLength(1)
  })

  it("posts to the endpoint with form-encoded body", async () => {
    let method = ""
    let contentType = ""
    let url = ""
    await lookupIcaoToIata(["EVA"], {
      fetchImpl: async (u, init) => {
        url = u.toString()
        method = init?.method ?? "GET"
        const headers = init?.headers as Record<string, string> | undefined
        contentType = headers?.["Content-Type"] ?? ""
        return jsonResponse({ results: { bindings: [] } })
      },
    })
    expect(method).toBe("POST")
    expect(contentType).toBe("application/x-www-form-urlencoded")
    // URL has no inline query string in POST mode.
    expect(url).toBe("https://query.wikidata.org/sparql")
  })

  it("caps the batch to MAX_CODES_PER_LOOKUP (500) so adversarial CSVs don't blow up the body", async () => {
    const codes: string[] = []
    // Build 1,000 unique 3-letter codes deterministically.
    for (let i = 0; i < 1000; i++) {
      const a = String.fromCharCode(65 + Math.floor(i / 676))
      const b = String.fromCharCode(65 + Math.floor((i % 676) / 26))
      const c = String.fromCharCode(65 + (i % 26))
      codes.push(`${a}${b}${c}`)
    }
    let body = ""
    await lookupIcaoToIata(codes, {
      fetchImpl: async (_u, init) => {
        body = String(init?.body ?? "")
        return jsonResponse({ results: { bindings: [] } })
      },
    })
    // Each code appears as %22XYZ%22 — count exactly the quoted tokens.
    const matches = body.match(/%22[A-Z]{3}%22/g) ?? []
    expect(matches.length).toBe(500)
  })

  it("returns a Map of ICAO → IATA from the SPARQL response", async () => {
    const result = await lookupIcaoToIata(["EVA", "UAE"], {
      fetchImpl: async () =>
        jsonResponse({
          results: {
            bindings: [
              { icao: { value: "EVA" }, iata: { value: "BR" } },
              { icao: { value: "UAE" }, iata: { value: "EK" } },
            ],
          },
        }),
    })
    expect(result.get("EVA")).toBe("BR")
    expect(result.get("UAE")).toBe("EK")
    expect(result.size).toBe(2)
  })

  it("keeps the first IATA when an ICAO has multiple Wikidata entries", async () => {
    const result = await lookupIcaoToIata(["UAE"], {
      fetchImpl: async () =>
        jsonResponse({
          results: {
            bindings: [
              { icao: { value: "UAE" }, iata: { value: "EK" } },
              { icao: { value: "UAE" }, iata: { value: "XX" } },
            ],
          },
        }),
    })
    expect(result.get("UAE")).toBe("EK")
  })

  it("returns an empty map and warns on non-200 response", async () => {
    const result = await lookupIcaoToIata(["EVA"], {
      fetchImpl: async () => new Response("upstream error", { status: 503 }),
    })
    expect(result.size).toBe(0)
  })

  it("returns an empty map when fetch throws", async () => {
    const result = await lookupIcaoToIata(["EVA"], {
      fetchImpl: async () => {
        throw new Error("network down")
      },
    })
    expect(result.size).toBe(0)
  })
})
