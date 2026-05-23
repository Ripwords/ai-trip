import assert from "node:assert/strict"
import { describe, it } from "bun:test"

import { softRemoveTripMember, upsertPendingTripMember } from "./trip-members"

type Call = { method: string; args: unknown[] }

function makeFakeDb(existingMember: Record<string, unknown> | null) {
  const calls: Call[] = []
  const findCallStack: Array<Record<string, unknown> | null> = [existingMember]

  const update = () => {
    let setArgs: unknown = null
    const chain = {
      set: (v: unknown) => {
        setArgs = v
        return chain
      },
      where: (w: unknown) => {
        calls.push({ method: "update", args: [{ set: setArgs, where: w }] })
        return Promise.resolve()
      },
    }
    return chain
  }

  const insert = () => {
    let valuesArgs: unknown = null
    const chain = {
      values: (v: unknown) => {
        valuesArgs = v
        calls.push({ method: "insert", args: [{ values: valuesArgs }] })
        return { returning: () => Promise.resolve([{ id: "new-member-id" }]) }
      },
    }
    return chain
  }

  const del = () => {
    const chain = {
      where: (w: unknown) => {
        calls.push({ method: "delete", args: [{ where: w }] })
        return Promise.resolve()
      },
    }
    return chain
  }

  const db = {
    query: {
      tripMembers: {
        findFirst: async (_opts: unknown) => {
          // First call returns the configured row. Any subsequent lookup (e.g.
          // the fallback by-email path when first lookup returns null) gets
          // null too, since by default no row matches.
          return findCallStack.length > 0 ? findCallStack.shift()! : null
        },
      },
    },
    update: () => update(),
    insert: () => insert(),
    delete: () => del(),
  } as unknown as Parameters<typeof softRemoveTripMember>[1]["db"]

  return { db, calls }
}

describe("softRemoveTripMember", () => {
  it("sets status='removed' and clears inviteToken on the matched member row", async () => {
    const { db, calls } = makeFakeDb({
      id: "m1",
      tripId: "trip-1",
      userId: "user-1",
      invitedEmail: null,
      user: { name: "Alice" },
    })

    const logCalls: unknown[] = []
    const result = await softRemoveTripMember(
      { tripId: "trip-1", tripMemberId: "m1", removerUserId: "owner-1" },
      {
        db,
        logTripAction: async (a) => {
          logCalls.push(a)
        },
      },
    )

    assert.deepEqual(result, { success: true })
    const updates = calls.filter((c) => c.method === "update")
    const deletes = calls.filter((c) => c.method === "delete")
    assert.equal(deletes.length, 0, "should not hard-delete")
    assert.equal(updates.length, 1)
    const update = updates[0]!.args[0] as { set: Record<string, unknown> }
    assert.equal(update.set.status, "removed")
    assert.equal(update.set.inviteToken, null)
    assert.equal(logCalls.length, 1)
  })

  it("writes a member_removed activity log with removedUserId metadata", async () => {
    const { db } = makeFakeDb({
      id: "m1",
      tripId: "trip-1",
      userId: "user-1",
      invitedEmail: null,
      user: { name: "Alice" },
    })
    const logCalls: { action: string; metadata: { removedUserId: string | null } }[] = []

    await softRemoveTripMember(
      { tripId: "trip-1", tripMemberId: "m1", removerUserId: "owner-1" },
      {
        db,
        logTripAction: async (a) => {
          logCalls.push(a as never)
        },
      },
    )

    assert.equal(logCalls.length, 1)
    assert.equal(logCalls[0]!.action, "member_removed")
    assert.equal(logCalls[0]!.metadata.removedUserId, "user-1")
  })

  it("throws a 404-shaped error when the member is not found", async () => {
    const { db } = makeFakeDb(null)
    let threw: { statusCode?: number } | null = null
    try {
      await softRemoveTripMember(
        { tripId: "trip-1", tripMemberId: "missing", removerUserId: "owner-1" },
        { db, logTripAction: async () => undefined },
      )
    } catch (e) {
      threw = e as { statusCode?: number }
    }
    assert.ok(threw, "should have thrown")
    assert.equal(threw!.statusCode, 404)
  })
})

describe("upsertPendingTripMember", () => {
  const baseArgs = {
    tripId: "trip-1",
    invitedEmail: "alice@example.com",
    role: "editor" as const,
    invitedByUserId: "owner-1",
    inviteTokenHash: "hash-abc",
    expiresAt: new Date("2026-06-01T00:00:00Z"),
  }

  it("throws 409 when an active row already exists for the same (tripId, userId)", async () => {
    const { db } = makeFakeDb({
      id: "existing-active",
      tripId: "trip-1",
      userId: "user-1",
      status: "active",
    })

    let threw: { statusCode?: number } | null = null
    try {
      await upsertPendingTripMember({ ...baseArgs, invitedUserId: "user-1" }, db)
    } catch (e) {
      threw = e as { statusCode?: number }
    }
    assert.ok(threw, "should have thrown for already-active member")
    assert.equal(threw!.statusCode, 409)
  })

  it("reactivates an existing non-active row instead of inserting", async () => {
    const { db, calls } = makeFakeDb({
      id: "existing-removed",
      tripId: "trip-1",
      userId: "user-1",
      status: "removed",
    })

    const result = await upsertPendingTripMember({ ...baseArgs, invitedUserId: "user-1" }, db)

    const updates = calls.filter((c) => c.method === "update")
    const inserts = calls.filter((c) => c.method === "insert")
    const deletes = calls.filter((c) => c.method === "delete")
    assert.equal(deletes.length, 0, "must not hard-delete under soft-delete model")
    assert.equal(inserts.length, 0, "should reuse existing row, not insert")
    assert.equal(updates.length, 1)
    const update = updates[0]!.args[0] as { set: Record<string, unknown> }
    assert.equal(update.set.status, "pending")
    assert.equal(update.set.inviteToken, "hash-abc")
    assert.equal(update.set.role, "editor")
    assert.equal(result.memberId, "existing-removed")
    assert.equal(result.reactivated, true)
  })

  it("links a previously-unregistered email row to the now-known userId on reactivation", async () => {
    // Pre-existing row was created when alice@example.com had no account
    // (userId=null). Alice has since signed up; the invite handler should
    // reactivate the row AND attach her userId to it.
    const { db, calls } = makeFakeDb({
      id: "existing-email-row",
      tripId: "trip-1",
      userId: null,
      invitedEmail: "alice@example.com",
      status: "removed",
    })

    await upsertPendingTripMember({ ...baseArgs, invitedUserId: "alice-user-id" }, db)

    const updates = calls.filter((c) => c.method === "update")
    assert.equal(updates.length, 1, "should reactivate the email-matched row")
    const update = updates[0]!.args[0] as { set: Record<string, unknown> }
    assert.equal(update.set.userId, "alice-user-id", "should attach the now-known userId")
  })

  it("inserts a new row when no prior membership exists", async () => {
    const { db, calls } = makeFakeDb(null)

    const result = await upsertPendingTripMember({ ...baseArgs, invitedUserId: null }, db)

    const inserts = calls.filter((c) => c.method === "insert")
    const updates = calls.filter((c) => c.method === "update")
    assert.equal(inserts.length, 1)
    assert.equal(updates.length, 0)
    const insert = inserts[0]!.args[0] as { values: Record<string, unknown> }
    assert.equal(insert.values.status, "pending")
    assert.equal(insert.values.invitedEmail, "alice@example.com")
    assert.equal(insert.values.role, "editor")
    assert.equal(insert.values.inviteToken, "hash-abc")
    assert.equal(result.reactivated, false)
  })
})
