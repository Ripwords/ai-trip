/**
 * Route-level coverage for `POST /api/trips/:id/members/invite`.
 *
 * B16: when the invite email failed, the response told the inviter to "share
 * the link manually" but never included the link — the raw token exists only
 * in this request (the database stores its hash), so it was lost for good.
 */
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { afterAll, beforeEach, describe, it } from "bun:test"
import { installNitroGlobals, makeEvent, resetHarness, type Handler } from "../route-test-harness"

installNitroGlobals()

const { db } = await import("../db")

const TRIP = "11111111-1111-4111-8111-111111111111"
const OWNER = "user-owner"

const original = {
  tripsFindFirst: db.query.trips.findFirst,
  userFindFirst: db.query.user.findFirst,
  membersFindFirst: db.query.tripMembers.findFirst,
  insert: db.insert,
  resendKey: process.env.RESEND_API_KEY,
}

afterAll(() => {
  db.query.trips.findFirst = original.tripsFindFirst
  db.query.user.findFirst = original.userFindFirst
  db.query.tripMembers.findFirst = original.membersFindFirst
  db.insert = original.insert
  if (original.resendKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = original.resendKey
})

interface InviteResponse {
  success: boolean
  emailSent?: boolean
  inviteUrl?: string
  expiresAt: string
}

const invite = (await import("../api/trips/[id]/members/invite.post"))
  .default as unknown as Handler<InviteResponse>

let storedTokenHash: string | undefined

beforeEach(() => {
  installNitroGlobals()
  resetHarness({ [TRIP]: { [OWNER]: "owner" } })
  storedTokenHash = undefined
  // No key: the email helper throws before any network call.
  delete process.env.RESEND_API_KEY
  db.query.trips.findFirst = (async () => ({
    id: TRIP,
    destination: "Tokyo",
  })) as unknown as typeof db.query.trips.findFirst
  db.query.user.findFirst = (async () => undefined) as unknown as typeof db.query.user.findFirst
  db.query.tripMembers.findFirst = (async () =>
    undefined) as unknown as typeof db.query.tripMembers.findFirst
  db.insert = (() => ({
    values: (values: { inviteToken: string }) => ({
      returning: async () => {
        storedTokenHash = values.inviteToken
        return [{ id: "member-1" }]
      },
    }),
  })) as unknown as typeof db.insert
})

describe("POST invite (B16)", () => {
  it("returns the invite link when the email fails to send", async () => {
    const res = await invite(
      makeEvent({ userId: OWNER, params: { id: TRIP }, body: { email: "friend@example.com" } }),
    )
    assert.equal(res.success, true)
    assert.equal(res.emailSent, false)
    assert.ok(res.inviteUrl, "the link must be in the response")
    const match = /\/invite\/([^/]+)$/.exec(res.inviteUrl)
    assert.ok(match, `unexpected invite URL ${res.inviteUrl}`)
    // The link carries the raw token whose hash was stored, so it will accept.
    const { createHash } = await import("node:crypto")
    assert.equal(createHash("sha256").update(match[1]!).digest("hex"), storedTokenHash)
  })
})
