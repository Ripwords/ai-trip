import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
}

const form = source("./AddFlightForm.vue")
const flightsPage = source("../pages/flights.vue")
const tripPage = source("../pages/trips/[id].vue")
const reservations = source("./ReservationTracker.vue")

/** Flights used to be entered three ways with two copies of the same form (U12). */
describe("one way to add a flight (U12)", () => {
  it("posts to /api/flights, linking the trip when one is given", () => {
    assert.match(form, /tripId\?: string/)
    assert.match(
      form,
      /\$fetch\("\/api\/flights", \{[\s\S]*?method: "POST"[\s\S]*?tripId: props\.tripId/,
    )
    assert.match(form, /emit\("added"\)/)
  })

  it("labels both inputs", () => {
    assert.equal(form.match(/<label :for=/g)?.length, 2)
  })

  it("is the form both /flights and the trip Flights tab render", () => {
    assert.match(flightsPage, /<AddFlightForm @added="refresh" \/>/)
    assert.match(tripPage, /<AddFlightForm :trip-id="tripId" @added="refreshFlights" \/>/)
    for (const page of [flightsPage, tripPage]) {
      assert.doesNotMatch(page, /placeholder="e\.g\. SQ638"/)
    }
  })

  it("no longer offers flight as a new booking type, but still renders existing ones", () => {
    const addTypes = reservations.match(/const addTypes = \[[^\]]*\]/)
    assert.ok(addTypes, "ReservationTracker declares addTypes")
    assert.doesNotMatch(addTypes[0], /"flight"/)
    assert.match(reservations, /flight: "lucide:plane"/)
    assert.match(reservations, /editingRow\.value\?\.type === "flight" \? types : addTypes/)
    assert.match(reservations, /to="\/flights"/)
  })
})
