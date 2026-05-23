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
    let captured = ""
    await lookupIcaoToIata(["EVA", "BR", "12", "AB", "uae", "Toolong"], {
      fetchImpl: async (url) => {
        captured = url.toString()
        return jsonResponse({ results: { bindings: [] } })
      },
    })
    // EVA and uae→UAE survive the filter; the rest are dropped.
    // URL is percent-encoded so check for the encoded quoted token.
    expect(captured).toContain("%22EVA%22")
    expect(captured).toContain("%22UAE%22")
    expect(captured).not.toContain("%22BR%22")
    expect(captured).not.toContain("%2212%22")
    expect(captured).not.toContain("%22TOOLONG%22")
    expect(captured).not.toContain("%22Toolong%22")
  })

  it("dedupes ICAO inputs before querying", async () => {
    let captured = ""
    await lookupIcaoToIata(["EVA", "EVA", "EVA"], {
      fetchImpl: async (url) => {
        captured = url.toString()
        return jsonResponse({ results: { bindings: [] } })
      },
    })
    expect(captured.match(/%22EVA%22/g)!).toHaveLength(1)
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
