import assert from "node:assert/strict"
import { describe, it } from "bun:test"

import { countTripParticipants, loadPartySize } from "./trips"

type MemberRow = { userId: string | null; invitedEmail: string | null }

/**
 * Minimal stand-in for the `db.select().from().where()` chain
 * `countTripParticipants` uses. `rows` is whatever the query would have
 * returned — the status filter itself is expressed in SQL and is not
 * re-simulated here.
 */
function fakeDb(rows: MemberRow[] | (() => never)) {
  return {
    select: () => ({
      from: () => ({
        where: async () => (typeof rows === "function" ? rows() : rows),
      }),
    }),
  } as unknown as Parameters<typeof countTripParticipants>[2] extends { db?: infer D } ? D : never
}

describe("countTripParticipants", () => {
  it("counts the owner even with no member rows", async () => {
    assert.equal(await countTripParticipants("t1", "owner", { db: fakeDb([]) }), 1)
  })

  it("counts the owner plus each accepted and pending member", async () => {
    const rows: MemberRow[] = [
      { userId: "u2", invitedEmail: "b@example.com" },
      { userId: null, invitedEmail: "c@example.com" },
    ]
    assert.equal(await countTripParticipants("t1", "owner", { db: fakeDb(rows) }), 3)
  })

  // `upsertPendingTripMember` reuses rows, but nothing in the schema enforces
  // it — a duplicate must not inflate the headcount the AI plans against.
  it("counts a person once when duplicate rows name them", async () => {
    const rows: MemberRow[] = [
      { userId: "u2", invitedEmail: "b@example.com" },
      { userId: "u2", invitedEmail: "b@example.com" },
      { userId: null, invitedEmail: "B@Example.com " },
    ]
    assert.equal(await countTripParticipants("t1", "owner", { db: fakeDb(rows) }), 3)
  })

  it("does not double-count an owner who also holds a member row", async () => {
    const rows: MemberRow[] = [{ userId: "owner", invitedEmail: "owner@example.com" }]
    assert.equal(await countTripParticipants("t1", "owner", { db: fakeDb(rows) }), 1)
  })

  it("skips rows that identify nobody", async () => {
    const rows: MemberRow[] = [{ userId: null, invitedEmail: null }]
    assert.equal(await countTripParticipants("t1", "owner", { db: fakeDb(rows) }), 1)
  })
})

describe("loadPartySize", () => {
  const trip = { id: "t1", userId: "owner", preferences: null }

  it("uses the explicit setting and never queries members", async () => {
    const exploding = fakeDb(() => {
      throw new Error("should not have queried members")
    })
    const party = await loadPartySize({ ...trip, preferences: { partySize: 5 } }, { db: exploding })
    assert.deepEqual(party, { size: 5, source: "setting" })
  })

  it("falls back to the member count when nothing is set", async () => {
    const rows: MemberRow[] = [
      { userId: "u2", invitedEmail: null },
      { userId: "u3", invitedEmail: null },
    ]
    assert.deepEqual(await loadPartySize(trip, { db: fakeDb(rows) }), {
      size: 3,
      source: "members",
    })
  })

  it("reports unknown for a solo owner rather than guessing one traveler", async () => {
    assert.deepEqual(await loadPartySize(trip, { db: fakeDb([]) }), {
      size: null,
      source: "unknown",
    })
  })

  // No AI request should 500 over a headcount — an unknown party size still
  // produces a usable prompt, it just asks the model to state its assumption.
  it("degrades to unknown when the member query fails", async () => {
    const exploding = fakeDb(() => {
      throw new Error("connection terminated unexpectedly")
    })
    assert.deepEqual(await loadPartySize(trip, { db: exploding }), {
      size: null,
      source: "unknown",
    })
  })
})
