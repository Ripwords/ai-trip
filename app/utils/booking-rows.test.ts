import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isDerivedBooking,
  bookingOriginHint,
  needsDetails,
  missingFieldLabel,
  missingFieldsSummary,
  editableBookingFields,
} from "./booking-rows"
import type { BookingRow } from "./booking-rows"

function booking(over: Partial<BookingRow> = {}): BookingRow {
  return {
    id: "r1",
    type: "accommodation",
    source: "manual",
    status: "confirmed",
    name: "Hotel Nikko",
    confirmationNumber: null,
    provider: null,
    notes: null,
    startDate: "2026-03-22T00:00:00.000Z",
    endDate: "2026-03-25T00:00:00.000Z",
    amount: null,
    detachedAt: null,
    itineraryDayId: null,
    missingFields: ["confirmationNumber", "provider", "amount"],
    ...over,
  }
}

describe("isDerivedBooking", () => {
  it("is true only for rows the itinerary owns", () => {
    assert.equal(isDerivedBooking(booking({ source: "stay" })), true)
    assert.equal(isDerivedBooking(booking({ source: "manual" })), false)
  })

  // A detached row is fully the user's again — name and dates included.
  it("is false once a row has been detached", () => {
    assert.equal(
      isDerivedBooking(booking({ source: "manual", detachedAt: "2026-04-01T00:00:00.000Z" })),
      false,
    )
  })
})

describe("bookingOriginHint", () => {
  it("labels a derived row as coming from the itinerary", () => {
    assert.equal(bookingOriginHint(booking({ source: "stay" })), "From itinerary")
  })

  it("explains a row whose stay went away instead of leaving it looking hand-typed", () => {
    assert.equal(
      bookingOriginHint(booking({ source: "manual", detachedAt: "2026-04-01T00:00:00.000Z" })),
      "No longer linked",
    )
  })

  it("says nothing about a plain manual row", () => {
    assert.equal(bookingOriginHint(booking()), null)
  })
})

describe("needsDetails", () => {
  it("flags a derived row that is still missing something", () => {
    assert.equal(needsDetails(booking({ source: "stay" })), true)
  })

  it("clears once every gap is filled", () => {
    assert.equal(needsDetails(booking({ source: "stay", missingFields: [] })), false)
  })

  // A hand-typed row without a PNR isn't incomplete — the user chose that.
  it("never nags about a manual row", () => {
    assert.equal(needsDetails(booking({ source: "manual" })), false)
  })
})

describe("missingFieldLabel", () => {
  it("names each gap in the words the form uses", () => {
    assert.equal(missingFieldLabel("confirmationNumber"), "confirmation number")
    assert.equal(missingFieldLabel("provider"), "provider")
    assert.equal(missingFieldLabel("amount"), "amount")
  })
})

describe("missingFieldsSummary", () => {
  it("reads as a sentence fragment, not a field list", () => {
    assert.equal(
      missingFieldsSummary(["confirmationNumber", "provider", "amount"]),
      "confirmation number, provider and amount",
    )
    assert.equal(
      missingFieldsSummary(["confirmationNumber", "amount"]),
      "confirmation number and amount",
    )
    assert.equal(missingFieldsSummary(["amount"]), "amount")
  })

  it("is empty when nothing is missing", () => {
    assert.equal(missingFieldsSummary([]), "")
  })
})

describe("editableBookingFields", () => {
  // The whole point of the linkage: never re-ask for the hotel name or the
  // dates the itinerary already knows.
  it("offers a derived row only the fields the itinerary can't know", () => {
    assert.deepEqual(editableBookingFields(booking({ source: "stay" })), [
      "status",
      "confirmationNumber",
      "provider",
      "amount",
      "notes",
    ])
  })

  it("offers a manual row everything", () => {
    assert.deepEqual(editableBookingFields(booking()), [
      "type",
      "status",
      "name",
      "confirmationNumber",
      "provider",
      "startDate",
      "endDate",
      "amount",
      "notes",
    ])
  })

  it("gives a detached row its name and dates back", () => {
    const fields = editableBookingFields(
      booking({ source: "manual", detachedAt: "2026-04-01T00:00:00.000Z" }),
    )
    assert.ok(fields.includes("name"))
    assert.ok(fields.includes("startDate"))
  })
})
