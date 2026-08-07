import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  SCHEDULE_RULES,
  addResultSchema,
  buildFlightsCtx,
  buildNextStayCtx,
  buildTripShapeCtx,
  fillGapsResultSchema,
  formatAnchor,
  optimizeResultSchema,
  rescheduleResultSchema,
} from "./ai"

describe("SCHEDULE_RULES", () => {
  it("contains a dedicated ROUTE LOGIC step that runs before times/order are chosen", () => {
    assert.match(SCHEDULE_RULES, /ROUTE LOGIC/)
    assert.match(SCHEDULE_RULES, /BEFORE picking times or order/i)
  })

  it("anchors the day on explicit start and end points", () => {
    assert.match(SCHEDULE_RULES, /anchors/i)
  })

  it("demands one continuous path with no doubling back", () => {
    assert.match(SCHEDULE_RULES, /continuous path/i)
    assert.match(SCHEDULE_RULES, /double back/i)
  })

  it("puts en-route stops on the day that actually travels that leg", () => {
    assert.match(SCHEDULE_RULES, /on the way between/i)
    assert.match(SCHEDULE_RULES, /round trip/i)
  })
})

describe("generation schemas", () => {
  it("addResultSchema requires routeReasoning as its first property", () => {
    assert.equal(Object.keys(addResultSchema.shape)[0], "routeReasoning")
    assert.equal(addResultSchema.shape.routeReasoning.safeParse(undefined).success, false)
  })

  it("fillGapsResultSchema requires routeReasoning as its first property", () => {
    assert.equal(Object.keys(fillGapsResultSchema.shape)[0], "routeReasoning")
    assert.equal(fillGapsResultSchema.shape.routeReasoning.safeParse(undefined).success, false)
  })

  it("optimizeResultSchema requires routeReasoning as its first property", () => {
    assert.equal(Object.keys(optimizeResultSchema.shape)[0], "routeReasoning")
    assert.equal(optimizeResultSchema.shape.routeReasoning.safeParse(undefined).success, false)
  })

  it("rescheduleResultSchema requires routeReasoning as its first property", () => {
    assert.equal(Object.keys(rescheduleResultSchema.shape)[0], "routeReasoning")
    assert.equal(rescheduleResultSchema.shape.routeReasoning.safeParse(undefined).success, false)
  })

  it("activity objects never carry routeReasoning (no leak into persisted activities)", () => {
    const activityShape = addResultSchema.shape.activities.element.shape
    assert.ok(!("routeReasoning" in activityShape))
  })
})

describe("buildOptimizeActivitiesPayload", () => {
  it("includes opening hours when the activity has them", async () => {
    const { buildOptimizeActivitiesPayload } = await import("./ai")
    const payload = buildOptimizeActivitiesPayload([
      {
        name: "Marble Mountains",
        type: "attraction",
        lat: 16.0,
        lng: 108.26,
        address: "Da Nang",
        openingHours: ["Monday: 7:00 AM – 5:30 PM"],
      },
      {
        name: "Beach",
        type: "attraction",
        lat: 16.05,
        lng: 108.25,
        address: null,
        openingHours: null,
      },
    ])
    assert.deepEqual(payload[0]?.hours, ["Monday: 7:00 AM – 5:30 PM"])
    assert.equal(payload[1]?.hours, undefined)
    assert.equal(payload[0]?.name, "Marble Mountains")
  })
})

describe("SCHEDULE_RULES evening proximity", () => {
  it("requires evening/night venues to be near where the traveler sleeps", () => {
    assert.match(SCHEDULE_RULES, /EVENING PROXIMITY/)
    assert.match(SCHEDULE_RULES, /where the traveler sleeps/i)
    assert.match(SCHEDULE_RULES, /after dark/i)
  })
})

describe("buildStrandedNote", () => {
  it("names evening activities far from the accommodation", async () => {
    const { buildStrandedNote } = await import("./ai")
    const note = buildStrandedNote(
      [
        { name: "Ha My Beach", lat: 15.927, lng: 108.322, suggestedTime: "14:15" },
        { name: "Dragon Bridge Show", lat: 16.061, lng: 108.228, suggestedTime: "22:30" },
      ],
      { name: "Four Seasons Nam Hai", lat: 15.929, lng: 108.318 },
    )
    assert.ok(note && note.includes("Dragon Bridge Show"))
    assert.ok(!note!.includes("Ha My Beach")) // daytime, not flagged
  })

  it("returns null when nothing is stranded or coords are missing", async () => {
    const { buildStrandedNote } = await import("./ai")
    assert.equal(
      buildStrandedNote(
        [{ name: "Resort dinner", lat: 15.929, lng: 108.317, suggestedTime: "19:30" }],
        { name: "Four Seasons", lat: 15.929, lng: 108.318 },
      ),
      null,
    )
    assert.equal(
      buildStrandedNote(
        [{ name: "X", lat: 16.06, lng: 108.23, suggestedTime: "22:00" }],
        undefined,
      ),
      null,
    )
  })
})

describe("formatAnchor", () => {
  it("includes the address and coordinates when known", () => {
    // The model was geolocating hotels from their NAME alone — ai.post.ts fetched
    // lat/lng then dropped them one line later, and the prompt rendered only the
    // name. Coordinates are the whole point of the anchor.
    const out = formatAnchor({
      name: "Hotel Gracery Shinjuku",
      address: "1-19-1 Kabukicho, Shinjuku City, Tokyo",
      lat: 35.6955,
      lng: 139.7006,
    })
    assert.ok(out.includes("Hotel Gracery Shinjuku"))
    assert.ok(out.includes("1-19-1 Kabukicho"))
    assert.ok(out.includes("35.6955"))
    assert.ok(out.includes("139.7006"))
  })

  it("degrades cleanly when coordinates are missing", () => {
    const out = formatAnchor({ name: "Some Guesthouse", address: null, lat: null, lng: null })
    assert.equal(out, "Some Guesthouse")
  })

  it("renders the address alone when only coordinates are missing", () => {
    const out = formatAnchor({
      name: "Some Guesthouse",
      address: "12 Main St",
      lat: null,
      lng: null,
    })
    assert.ok(out.includes("12 Main St"))
    assert.ok(!out.includes("["), "no empty coordinate bracket")
  })
})

describe("buildFlightsCtx", () => {
  const flights = [
    {
      departureAirport: "SIN",
      arrivalAirport: "NRT",
      departureTimeUtc: null,
      arrivalTimeUtc: null,
      departureTimeLocal: "2026-08-10 08:00+08:00",
      arrivalTimeLocal: "2026-08-10 16:20+09:00",
    },
    {
      departureAirport: "NRT",
      arrivalAirport: "SIN",
      departureTimeUtc: null,
      arrivalTimeUtc: null,
      departureTimeLocal: "2026-08-17 10:30+09:00",
      arrivalTimeLocal: "2026-08-17 17:05+08:00",
    },
  ]

  it("returns an empty string when there are no flights", () => {
    assert.equal(buildFlightsCtx(), "")
    assert.equal(buildFlightsCtx([]), "")
  })

  it("lists every flight, so the return leg is always visible", () => {
    const out = buildFlightsCtx(flights)
    assert.ok(out.includes("SIN → NRT"))
    assert.ok(out.includes("NRT → SIN"))
  })

  it("marks which flight falls on the day being planned", () => {
    // Without this the model had to date-match the list itself against the day
    // in scope, and silently mis-attributed flights on multi-flight trips.
    const out = buildFlightsCtx(flights, "2026-08-17")
    const lines = out.split("\n").filter((l) => l.startsWith("- "))
    const tagged = lines.filter((l) => l.includes("THIS DAY"))
    assert.equal(tagged.length, 1)
    assert.ok(tagged[0]!.includes("NRT → SIN"), "the departure leg is the one on 2026-08-17")
  })

  it("tags nothing when no flight falls on the planning date", () => {
    const out = buildFlightsCtx(flights, "2026-08-13")
    assert.ok(!out.includes("THIS DAY"))
  })

  it("omits the tag entirely when no planning date is supplied", () => {
    assert.ok(!buildFlightsCtx(flights).includes("THIS DAY"))
  })

  it("tells the model to bias a departure day toward the airport", () => {
    // Times alone never biased the last day's geography — the traveler could be
    // routed to the far side of the region on their departure morning.
    const out = buildFlightsCtx(flights, "2026-08-17")
    assert.ok(/departure airport/i.test(out))
  })

  it("keeps the existing hard timing rules", () => {
    const out = buildFlightsCtx(flights, "2026-08-10")
    assert.ok(out.includes("90 minutes"), "arrival buffer rule")
    assert.ok(out.includes("3 hours"), "departure buffer rule")
  })

  it("still applies the arrival/departure buffer rules when no planning date is given", () => {
    // Regression guard: callers with no single planning day (handleReschedule,
    // discuss context) never tag any leg. The "only a flagged leg constrains
    // this day" rule must NOT be emitted in that case — it would tell the model
    // to disregard every flight's timing, silently suppressing the buffers below.
    const out = buildFlightsCtx(flights)
    assert.ok(out.includes("90 minutes"), "arrival buffer rule must still be present")
    assert.ok(out.includes("3 hours"), "departure buffer rule must still be present")
    assert.ok(
      !/only a (leg )?flagged|disregard|do not apply|don't apply/i.test(out),
      "must not instruct the model to disregard/not-apply flight timings",
    )
  })

  it("only states the 'only a flagged leg constrains this day' rule when a planning date is supplied", () => {
    const out = buildFlightsCtx(flights, "2026-08-17")
    assert.ok(/only a leg flagged/i.test(out))
  })
})

describe("buildNextStayCtx", () => {
  const next = {
    name: "Ryokan Kurashiki",
    address: "4-1 Honmachi, Kurashiki",
    lat: 34.5951,
    lng: 133.7715,
  }

  it("returns an empty string when there is no later stay", () => {
    assert.equal(buildNextStayCtx(null, { name: "Hotel Gracery Shinjuku" }), "")
    assert.equal(buildNextStayCtx(undefined, { name: "Hotel Gracery Shinjuku" }), "")
  })

  it("returns an empty string when the traveler does not move", () => {
    // "You relocate to Hotel X" when they are already at Hotel X is noise that
    // invites the model to invent a transfer that isn't happening.
    assert.equal(
      buildNextStayCtx(
        { ...next, name: "Hotel Gracery Shinjuku" },
        {
          name: "Hotel Gracery Shinjuku",
        },
      ),
      "",
    )
  })

  it("ignores case and surrounding whitespace when comparing stays", () => {
    assert.equal(
      buildNextStayCtx(
        { ...next, name: " hotel gracery SHINJUKU " },
        {
          name: "Hotel Gracery Shinjuku",
        },
      ),
      "",
    )
  })

  it("names the next base with full precision when the traveler relocates", () => {
    const out = buildNextStayCtx(next, { name: "Hotel Gracery Shinjuku" })
    assert.ok(out.includes("Ryokan Kurashiki"))
    assert.ok(out.includes("34.5951"))
  })

  it("tells the model to shorten tomorrow's transfer and not strand the traveler", () => {
    const out = buildNextStayCtx(next, { name: "Hotel Gracery Shinjuku" })
    assert.ok(/transfer/i.test(out))
    assert.ok(/strand|far from/i.test(out))
  })

  it("still emits guidance when tonight's stay is unknown", () => {
    // A day with no accommodation of its own still benefits from knowing where
    // the traveler ends up next.
    const out = buildNextStayCtx(next, null)
    assert.ok(out.includes("Ryokan Kurashiki"))
  })
})

describe("buildTripShapeCtx", () => {
  const days = [
    { dayNumber: 1, date: "2026-08-10", accommodationName: "Hotel Gracery Shinjuku" },
    { dayNumber: 2, date: "2026-08-11", accommodationName: null },
    { dayNumber: 3, date: "2026-08-12", accommodationName: "Ryokan Kurashiki" },
  ]

  it("returns an empty string when there is nothing to show", () => {
    assert.equal(buildTripShapeCtx([], 1), "")
  })

  it("lists every day with its date and stay", () => {
    // Day generation only ever saw its OWN day plus a flat list of other
    // days' activity names — it could not see the trip's shape at all.
    const out = buildTripShapeCtx(days, 2)
    assert.ok(out.includes("Day 1"))
    assert.ok(out.includes("Day 3"))
    assert.ok(out.includes("Ryokan Kurashiki"))
  })

  it("marks the day being planned", () => {
    const out = buildTripShapeCtx(days, 2)
    const marked = out.split("\n").filter((l) => l.includes("PLANNING NOW"))
    assert.equal(marked.length, 1)
    assert.ok(marked[0]!.includes("Day 2"))
  })

  it("carries a multi-night stay forward instead of showing a gap", () => {
    // Day 2 sets no accommodation of its own: the traveler is still at Day 1's
    // hotel. Rendering it blank reads as "no stay booked" and invites the model
    // to treat the day as unanchored.
    const out = buildTripShapeCtx(days, 1)
    const day2 = out.split("\n").find((l) => l.includes("Day 2"))
    assert.ok(day2?.includes("Hotel Gracery Shinjuku"))
  })

  it("does not invent a stay before the first one is known", () => {
    const out = buildTripShapeCtx(
      [{ dayNumber: 1, date: "2026-08-10", accommodationName: null }, ...days.slice(1)],
      1,
    )
    const day1 = out.split("\n").find((l) => l.includes("Day 1"))
    assert.ok(!day1?.includes("staying at"))
  })
})
