import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { reservations } from "../db/schema"

const {
  missingBookingFields,
  matchReservationToStay,
  planStayReconciliation,
  upsertStayBooking,
  detachStayBooking,
} = await import("./booking-sync")

type StayBookingCandidate = import("./booking-sync").StayBookingCandidate
type StayBookingSource = import("./booking-sync").StayBookingSource
type Tx = import("./stays").Tx
type StayRun = import("./stays").StayRun

function run(overrides: Partial<StayRun> & Pick<StayRun, "key" | "checkIn" | "checkOut">): StayRun {
  return {
    name: "Hotel Nikko",
    placeId: null,
    address: null,
    lat: null,
    lng: null,
    dayIds: [],
    ...overrides,
  }
}

interface Recorded {
  op: "insert" | "update"
  table: unknown
  values: Record<string, unknown>
}

/**
 * Structural fake for the drizzle transaction handle. `existing` is what a
 * `select ... from reservations` resolves to, which is how the upsert decides
 * between adopting a row and creating one.
 */
function makeFakeTx(existing: Record<string, unknown>[] = []) {
  const ops: Recorded[] = []
  const fake = {
    select: () => ({ from: (table: unknown) => ({ where: async () => (table ? existing : []) }) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          ops.push({ op: "insert", table, values })
          return [{ id: "new-reservation", ...values }]
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          ops.push({ op: "update", table, values })
        },
      }),
    }),
  }
  return { tx: fake as unknown as Tx, ops }
}

const stay: StayBookingSource = {
  id: "stay-1",
  tripId: "trip-1",
  name: "Hotel Nikko",
  checkIn: "2026-03-22",
  checkOut: "2026-03-25",
}

describe("missingBookingFields", () => {
  it("lists every gap a derived row still needs from the user", () => {
    assert.deepEqual(
      missingBookingFields({ confirmationNumber: null, provider: null, amount: null }),
      ["confirmationNumber", "provider", "amount"],
    )
  })

  it("drops fields the user has already filled in", () => {
    assert.deepEqual(
      missingBookingFields({ confirmationNumber: "ABC123", provider: null, amount: "900.00" }),
      ["provider"],
    )
  })

  it("treats whitespace as missing", () => {
    assert.deepEqual(
      missingBookingFields({ confirmationNumber: "  ", provider: "  ", amount: null }),
      ["confirmationNumber", "provider", "amount"],
    )
  })

  it("returns nothing when the booking is complete", () => {
    assert.deepEqual(
      missingBookingFields({
        confirmationNumber: "ABC123",
        provider: "Booking.com",
        amount: "900.00",
      }),
      [],
    )
  })
})

describe("matchReservationToStay", () => {
  function candidate(over: Partial<StayBookingCandidate> = {}): StayBookingCandidate {
    return {
      id: "r1",
      name: "Hotel Nikko",
      startDate: "2026-03-22",
      endDate: "2026-03-25",
      ...over,
    }
  }

  it("adopts a single exact name match", () => {
    assert.deepEqual(matchReservationToStay(stay, [candidate()]), {
      kind: "adopt",
      reservationId: "r1",
    })
  })

  it("matches names case- and whitespace-insensitively", () => {
    assert.deepEqual(matchReservationToStay(stay, [candidate({ name: "  hotel NIKKO " })]), {
      kind: "adopt",
      reservationId: "r1",
    })
  })

  it("breaks a name tie with date overlap", () => {
    const result = matchReservationToStay(stay, [
      candidate({ id: "r1", startDate: "2026-04-10", endDate: "2026-04-12" }),
      candidate({ id: "r2" }),
    ])
    assert.deepEqual(result, { kind: "adopt", reservationId: "r2" })
  })

  it("reports ambiguity when two same-named rows both overlap", () => {
    const result = matchReservationToStay(stay, [candidate({ id: "r1" }), candidate({ id: "r2" })])
    assert.deepEqual(result, { kind: "ambiguous", reservationIds: ["r1", "r2"] })
  })

  // The whole point of the ambiguity rule: attaching the wrong PNR to the
  // wrong stay is worse than leaving the row alone for the user to link.
  it("never auto-merges a differently-named row on date overlap alone", () => {
    const result = matchReservationToStay(stay, [candidate({ id: "r9", name: "Ryokan Asaba" })])
    assert.deepEqual(result, { kind: "ambiguous", reservationIds: ["r9"] })
  })

  it("returns none when nothing matches by name or dates", () => {
    const result = matchReservationToStay(stay, [
      candidate({ id: "r9", name: "Ryokan Asaba", startDate: "2026-09-01", endDate: "2026-09-03" }),
    ])
    assert.deepEqual(result, { kind: "none" })
  })

  it("returns none for an empty candidate list", () => {
    assert.deepEqual(matchReservationToStay(stay, []), { kind: "none" })
  })
})

describe("upsertStayBooking", () => {
  it("creates a derived booking when the stay has none", async () => {
    const { tx, ops } = makeFakeTx([])
    await upsertStayBooking(tx, stay, "user-1")

    assert.equal(ops.length, 1)
    assert.equal(ops[0]!.op, "insert")
    assert.equal(ops[0]!.table, reservations)
    assert.equal(ops[0]!.values.source, "stay")
    assert.equal(ops[0]!.values.type, "accommodation")
    assert.equal(ops[0]!.values.stayId, "stay-1")
    assert.equal(ops[0]!.values.name, "Hotel Nikko")
    assert.equal(ops[0]!.values.createdById, "user-1")
  })

  it("is idempotent — a second run updates the existing row instead of inserting", async () => {
    const { tx, ops } = makeFakeTx([
      { id: "r1", stayId: "stay-1", source: "stay", confirmationNumber: null, amount: null },
    ])
    await upsertStayBooking(tx, stay, "user-1")

    assert.equal(ops.length, 1)
    assert.equal(ops[0]!.op, "update")
    assert.equal(ops[0]!.values.name, "Hotel Nikko")
  })

  // The mirrored fields are the stay's to own; the money and the PNR are the
  // user's, and no automated path may overwrite them.
  it("never touches the user-entered confirmation number, provider, amount or status", async () => {
    const { tx, ops } = makeFakeTx([
      {
        id: "r1",
        stayId: "stay-1",
        source: "stay",
        confirmationNumber: "ABC123",
        amount: "900.00",
        provider: "Booking.com",
        status: "confirmed",
      },
    ])
    await upsertStayBooking(tx, stay, "user-1")

    const written = Object.keys(ops[0]!.values)
    for (const field of ["confirmationNumber", "amount", "provider", "status", "notes"]) {
      assert.ok(!written.includes(field), `${field} must not be rewritten by the sync`)
    }
  })

  it("mirrors the stay's dates onto the booking", async () => {
    const { tx, ops } = makeFakeTx([])
    await upsertStayBooking(tx, stay, "user-1")

    assert.deepEqual(ops[0]!.values.startDate, new Date("2026-03-22T00:00:00.000Z"))
    assert.deepEqual(ops[0]!.values.endDate, new Date("2026-03-25T00:00:00.000Z"))
  })
})

describe("detachStayBooking", () => {
  it("clears the link and flips the row back to manual without deleting it", async () => {
    const { tx, ops } = makeFakeTx()
    await detachStayBooking(tx, "stay-1")

    assert.equal(ops.length, 1)
    assert.equal(ops[0]!.op, "update")
    assert.equal(ops[0]!.table, reservations)
    assert.deepEqual(ops[0]!.values, { stayId: null, source: "manual" })
  })

  it("issues no delete — a paid PNR is never destroyed by an unlink", async () => {
    const { tx, ops } = makeFakeTx()
    await detachStayBooking(tx, "stay-1")
    assert.ok(ops.every((o) => o.op !== "insert"))
  })
})

describe("planStayReconciliation", () => {
  const existing = [
    { id: "stay-1", key: "place-abc", checkIn: "2026-03-22", checkOut: "2026-03-25" },
  ]

  it("creates a stay for a run with nothing to match", () => {
    const plan = planStayReconciliation({
      runs: [run({ key: "place-abc", checkIn: "2026-03-22", checkOut: "2026-03-25" })],
      existing: [],
    })

    assert.equal(plan.create.length, 1)
    assert.equal(plan.update.length, 0)
    assert.equal(plan.remove.length, 0)
  })

  it("updates in place when the run just grew another night", () => {
    const plan = planStayReconciliation({
      runs: [run({ key: "place-abc", checkIn: "2026-03-22", checkOut: "2026-03-26" })],
      existing,
    })

    assert.equal(plan.create.length, 0)
    assert.deepEqual(plan.update, [
      {
        stayId: "stay-1",
        run: run({ key: "place-abc", checkIn: "2026-03-22", checkOut: "2026-03-26" }),
      },
    ])
    assert.equal(plan.remove.length, 0)
  })

  // Splitting one run into two must keep the booking (and its PNR) attached to
  // the larger half rather than dropping both and re-creating.
  it("keeps the existing stay on the most-overlapping half when a run splits", () => {
    const plan = planStayReconciliation({
      runs: [
        run({ key: "place-abc", checkIn: "2026-03-22", checkOut: "2026-03-24" }),
        run({ key: "place-abc", checkIn: "2026-03-26", checkOut: "2026-03-27" }),
      ],
      existing,
    })

    assert.equal(plan.update.length, 1)
    assert.equal(plan.update[0]!.stayId, "stay-1")
    assert.equal(plan.update[0]!.run.checkIn, "2026-03-22")
    assert.equal(plan.create.length, 1)
    assert.equal(plan.create[0]!.checkIn, "2026-03-26")
    assert.equal(plan.remove.length, 0)
  })

  it("removes a stay whose run is gone", () => {
    const plan = planStayReconciliation({ runs: [], existing })
    assert.deepEqual(plan.remove, ["stay-1"])
  })

  it("never reuses a stay for a run under a different key", () => {
    const plan = planStayReconciliation({
      runs: [run({ key: "place-xyz", checkIn: "2026-03-22", checkOut: "2026-03-25" })],
      existing,
    })

    assert.equal(plan.update.length, 0)
    assert.equal(plan.create.length, 1)
    assert.deepEqual(plan.remove, ["stay-1"])
  })

  it("is idempotent — replanning an already-reconciled trip is a no-op update", () => {
    const plan = planStayReconciliation({
      runs: [run({ key: "place-abc", checkIn: "2026-03-22", checkOut: "2026-03-25" })],
      existing,
    })

    assert.equal(plan.create.length, 0)
    assert.equal(plan.remove.length, 0)
    assert.equal(plan.update.length, 1)
  })
})
