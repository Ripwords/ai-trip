/**
 * B7: "Undo AI changes" deleted every activity on the day and re-inserted the
 * snapshot. The ids changed, so every comment, vote and participant cascaded
 * away and every linked expense was unlinked — on activities the AI had never
 * touched. The plan keeps an activity that still exists, by id.
 */
import assert from "node:assert/strict"
import { describe, it } from "bun:test"
import { planDayRestore } from "./day-restore"

const KEPT = "11111111-1111-4111-8111-111111111111"
const EDITED = "22222222-2222-4222-8222-222222222222"
const REMOVED_BY_AI = "33333333-3333-4333-8333-333333333333"
const ADDED_BY_AI = "44444444-4444-4444-8444-444444444444"

describe("planDayRestore", () => {
  it("updates surviving activities in place, re-inserts removed ones, deletes additions", () => {
    const plan = planDayRestore(
      [KEPT, EDITED, ADDED_BY_AI],
      [
        { id: KEPT, name: "Senso-ji", sortOrder: 0 },
        { id: EDITED, name: "Ueno Park", sortOrder: 1 },
        { id: REMOVED_BY_AI, name: "Ameyoko", sortOrder: 2 },
      ],
    )
    assert.deepEqual(plan.updates, [
      { id: KEPT, values: { name: "Senso-ji", sortOrder: 0 } },
      { id: EDITED, values: { name: "Ueno Park", sortOrder: 1 } },
    ])
    assert.deepEqual(plan.inserts, [{ name: "Ameyoko", sortOrder: 2 }])
    assert.deepEqual(plan.deleteIds, [ADDED_BY_AI])
  })

  it("never deletes an activity the snapshot still holds", () => {
    const plan = planDayRestore([KEPT], [{ id: KEPT, name: "Senso-ji", sortOrder: 0 }])
    assert.deepEqual(plan.deleteIds, [])
    assert.deepEqual(plan.inserts, [])
  })

  // An old client sends no ids: fall back to replacing the day, as before.
  it("replaces the day when the snapshot carries no ids", () => {
    const plan = planDayRestore([KEPT, EDITED], [{ name: "Senso-ji", sortOrder: 0 }])
    assert.deepEqual(plan.updates, [])
    assert.deepEqual(plan.inserts, [{ name: "Senso-ji", sortOrder: 0 }])
    assert.deepEqual(plan.deleteIds, [KEPT, EDITED])
  })

  it("updates a repeated id once and inserts the repeat", () => {
    const plan = planDayRestore(
      [KEPT],
      [
        { id: KEPT, name: "A", sortOrder: 0 },
        { id: KEPT, name: "B", sortOrder: 1 },
      ],
    )
    assert.deepEqual(plan.updates, [{ id: KEPT, values: { name: "A", sortOrder: 0 } }])
    assert.deepEqual(plan.inserts, [{ name: "B", sortOrder: 1 }])
  })
})
