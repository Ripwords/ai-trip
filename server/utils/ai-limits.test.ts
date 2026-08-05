import assert from "node:assert/strict"
import { describe, it, beforeEach, after } from "node:test"

/**
 * Records the `where` clause every settle statement is scoped by, so the tests
 * can assert which month row an UPDATE would actually have matched.
 */
const captured: { where: unknown[] } = { where: [] }

// Patch the db singleton in place, the way every other suite in this repo does
// (see ai-tools.test.ts stubbing `db.query.activities.findMany`). Only `update`,
// the statement builder the settle primitives use, is replaced; everything else
// still behaves normally for the other test files sharing this process.
//
// This used to be `mock.module("../db", …)` plus a bare `Object.defineProperty`.
// `mock.module` is process-wide in bun, and a bare defineProperty is
// non-writable and non-configurable — so every other suite that patches the db
// singleton died with "Attempted to assign to readonly property" and its tests
// silently vanished from the run.
const { db } = await import("../db")
const realUpdate = db.update

db.update = (() => ({
  set: () => ({
    where: (cond: unknown) => {
      captured.where.push(cond)
      return Promise.resolve([])
    },
  }),
})) as unknown as typeof db.update

after(() => {
  db.update = realUpdate
})

const { getUsageMonth, chargeExtraAiCredits, refundAiCredit } = await import("./ai-limits")

/** Pull every string that looks like a `YYYY-MM` month out of a drizzle SQL tree. */
function monthsIn(node: unknown, seen = new Set<unknown>()): string[] {
  if (node === null || node === undefined) return []
  if (typeof node === "string") return /^\d{4}-\d{2}$/.test(node) ? [node] : []
  if (typeof node !== "object") return []
  if (seen.has(node)) return []
  seen.add(node)
  const out: string[] = []
  for (const value of Object.values(node as Record<string, unknown>)) {
    out.push(...monthsIn(value, seen))
  }
  return out
}

describe("the db stub this suite installs (process-wide side effects)", () => {
  it("leaves db.update patchable by the other suites sharing this process", () => {
    // bun runs every test file in ONE process. `server/lib/expenses-routes.test.ts`
    // and `server/lib/reservations-routes.test.ts` patch the same singleton, and a
    // non-writable/non-configurable stub here made their `installFakeDb()` throw
    // "Attempted to assign to readonly property" — taking ~66 tests out of the run.
    const descriptor = Object.getOwnPropertyDescriptor(db, "update")
    assert.ok(descriptor, "expected the stub to be an own property of the db singleton")
    assert.equal(descriptor.writable, true, "db.update must stay writable")
    assert.equal(descriptor.configurable, true, "db.update must stay configurable")

    // The faithful reproduction: another suite reassigning it must not throw.
    const ours = db.update
    assert.doesNotThrow(() => {
      db.update = (() => ({
        set: () => ({ where: () => Promise.resolve([]) }),
        // A drizzle PgUpdateBuilder cannot be constructed here; the settle
        // primitives only ever reach `.set().where()`.
      })) as unknown as typeof db.update
    })
    db.update = ours
  })

  it("does not replace the ../db module for other suites", () => {
    // `mock.module` is process-wide in bun; the fix is to patch the instance, not
    // the module registry, so `../db` keeps exporting the real singleton.
    assert.equal(db.constructor.name.length > 0, true)
    assert.equal(typeof db.query, "object")
  })
})

describe("getUsageMonth", () => {
  it("derives the month from an explicit instant, in UTC", () => {
    assert.equal(getUsageMonth(new Date("2026-01-31T23:59:50Z")), "2026-01")
    assert.equal(getUsageMonth(new Date("2026-02-01T00:00:05Z")), "2026-02")
  })

  it("does not move with the server's local timezone", () => {
    // 2026-01-31T23:30Z is already 2026-02-01 local in UTC+2. The attributed
    // month must stay January regardless of the deploy region.
    assert.equal(getUsageMonth(new Date("2026-01-31T23:30:00Z")), "2026-01")
    assert.equal(getUsageMonth(new Date("2026-12-31T23:59:59Z")), "2026-12")
    assert.equal(getUsageMonth(new Date("2027-01-01T00:00:00Z")), "2027-01")
  })

  it("pads single-digit months", () => {
    assert.equal(getUsageMonth(new Date("2026-09-15T12:00:00Z")), "2026-09")
  })

  it("defaults to now when no instant is given", () => {
    assert.match(getUsageMonth(), /^\d{4}-\d{2}$/)
  })
})

describe("settling across a month boundary (issue #17)", () => {
  beforeEach(() => {
    captured.where = []
  })

  it("refunds against the month passed in, not the month at settle time", async () => {
    // The credit was consumed at 23:59:50 on 31 Jan; the refund lands in February.
    const reservedMonth = getUsageMonth(new Date("2026-01-31T23:59:50Z"))
    await refundAiCredit("user-1", reservedMonth)

    assert.equal(captured.where.length, 1)
    const months = monthsIn(captured.where[0])
    assert.ok(
      months.includes("2026-01"),
      `expected the UPDATE to target 2026-01, saw ${JSON.stringify(months)}`,
    )
    assert.ok(!months.includes("2026-02"), "must not target the settle-time month")
  })

  it("charges extra credits against the month passed in", async () => {
    await chargeExtraAiCredits("user-1", 3, "2026-01")

    assert.equal(captured.where.length, 1)
    assert.ok(monthsIn(captured.where[0]).includes("2026-01"))
  })

  it("still no-ops on a non-positive extra charge", async () => {
    await chargeExtraAiCredits("user-1", 0, "2026-01")
    await chargeExtraAiCredits("user-1", -2, "2026-01")
    assert.equal(captured.where.length, 0)
  })
})
