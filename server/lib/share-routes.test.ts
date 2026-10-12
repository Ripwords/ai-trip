/**
 * Route-level coverage for `POST /api/trips/:id/share` (the share toggle).
 *
 * B17: the toggle looked only at `shareToken`, so once a link passed its
 * 30-day `shareExpiresAt` the trip still read as "shared" — and clicking the
 * toggle to get a working link *unshared* it instead. An expired link is now
 * treated as not shared: toggling issues a fresh token and a fresh expiry.
 */
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { afterAll, beforeEach, describe, it } from "bun:test"
import { installNitroGlobals, makeEvent, resetHarness, type Handler } from "../route-test-harness"

installNitroGlobals()

const { db } = await import("../db")

const TRIP = "11111111-1111-4111-8111-111111111111"
const OWNER = "user-owner"
const DAY_MS = 24 * 60 * 60 * 1000

interface StoredShare {
  shareToken: string | null
  shareExpiresAt: Date | null
}

let stored: StoredShare = { shareToken: null, shareExpiresAt: null }

const original = { tripsFindFirst: db.query.trips.findFirst, update: db.update }

afterAll(() => {
  db.query.trips.findFirst = original.tripsFindFirst
  db.update = original.update
})

interface ShareResponse {
  shareToken: string | null
  shared: boolean
  expiresAt: string | null
}

const toggle = (await import("../api/trips/[id]/share.post"))
  .default as unknown as Handler<ShareResponse>

const event = () => makeEvent({ userId: OWNER, params: { id: TRIP } })

beforeEach(() => {
  installNitroGlobals()
  resetHarness({ [TRIP]: { [OWNER]: "owner" } })
  db.query.trips.findFirst = (async () => ({
    id: TRIP,
    ...stored,
  })) as unknown as typeof db.query.trips.findFirst
  db.update = (() => ({
    set: (values: StoredShare) => ({
      where: async () => {
        stored = values
      },
    }),
  })) as unknown as typeof db.update
})

describe("POST share toggle (B17)", () => {
  it("re-issues a fresh link when the current one has expired", async () => {
    stored = { shareToken: "stale-token", shareExpiresAt: new Date(Date.now() - DAY_MS) }
    const res = await toggle(event())
    assert.equal(res.shared, true)
    assert.ok(res.shareToken)
    assert.notEqual(res.shareToken, "stale-token")
    assert.ok(res.expiresAt)
    assert.ok(new Date(res.expiresAt).getTime() > Date.now() + 29 * DAY_MS)
    assert.equal(stored.shareToken, res.shareToken)
  })

  it("unshares a live link", async () => {
    stored = { shareToken: "live-token", shareExpiresAt: new Date(Date.now() + DAY_MS) }
    const res = await toggle(event())
    assert.deepEqual(res, { shareToken: null, shared: false, expiresAt: null })
    assert.deepEqual(stored, { shareToken: null, shareExpiresAt: null })
  })

  it("shares an unshared trip and returns when the link expires", async () => {
    stored = { shareToken: null, shareExpiresAt: null }
    const res = await toggle(event())
    assert.equal(res.shared, true)
    assert.equal(res.expiresAt, stored.shareExpiresAt?.toISOString())
  })
})
