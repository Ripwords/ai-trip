import assert from "node:assert/strict"
import { describe, it, beforeEach } from "node:test"
import { mock } from "bun:test"

/**
 * Records the `where` clause every settle statement is scoped by, so the tests
 * can assert which month row an UPDATE would actually have matched.
 */
const captured: { where: unknown[] } = { where: [] }

// `mock.module` is process-wide in bun, and every server module resolves the same
// `server/db` instance — so the stub delegates to the real client via the
// prototype chain and overrides ONLY `update`, the statement builder the settle
// primitives use. Anything else (db.query.*, db.insert) still behaves normally
// for the other test files sharing this process.
const { db: realDb } = await import("../db")

const recordingDb: typeof realDb = Object.create(realDb)
Object.defineProperty(recordingDb, "update", {
  value: () => ({
    set: () => ({
      where: (cond: unknown) => {
        captured.where.push(cond)
        return Promise.resolve([])
      },
    }),
  }),
})

mock.module("../db", () => ({ db: recordingDb }))

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
