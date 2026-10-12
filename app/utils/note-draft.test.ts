import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { noteChanged, normalizeNote } from "./note-draft"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

describe("normalizeNote", () => {
  it("stores blank text as no note", () => {
    assert.equal(normalizeNote(""), null)
    assert.equal(normalizeNote("   \n"), null)
    assert.equal(normalizeNote(null), null)
    assert.equal(normalizeNote(undefined), null)
  })

  it("keeps real text exactly as typed", () => {
    assert.equal(normalizeNote("  Book the ryokan\n"), "  Book the ryokan\n")
  })
})

describe("noteChanged (B2)", () => {
  it("does not save when the draft matches what is saved", () => {
    assert.equal(noteChanged("Pack umbrella", "Pack umbrella"), false)
    assert.equal(noteChanged(null, ""), false)
    assert.equal(noteChanged("", "  "), false)
  })

  it("saves a real edit, including clearing the note", () => {
    assert.equal(noteChanged("Pack umbrella", "Pack umbrella and coat"), true)
    assert.equal(noteChanged(null, "New"), true)
    assert.equal(noteChanged("Old", ""), true)
  })
})

describe("note editors keep their saved text (B2)", () => {
  const daySection = read("../components/DaySection.vue")
  const tripNotes = read("../components/TripNotesPanel.vue")
  const page = read("../pages/trips/[id].vue")

  it("day notes skip unchanged blurs and say which day they belong to", () => {
    assert.ok(daySection.includes("noteChanged("), "DaySection never compares before saving")
    assert.ok(
      /updateNotes: \[dayId: string, notes: string \| null\]/.test(daySection),
      "updateNotes does not carry the day id",
    )
  })

  it("the page writes a saved day note back into its own copy of the trip", () => {
    const handler = page.slice(page.indexOf("async function handleUpdateDayNotes"))
    const body = handler.slice(0, handler.indexOf("\n}\n"))
    assert.ok(/day\.notes = /.test(body), "handler never updates the local day")
    assert.ok(!body.includes("activeDayId.value"), "handler still saves to whichever day is open")
  })

  it("trip notes skip unchanged blurs and report the saved text upward", () => {
    assert.ok(tripNotes.includes("noteChanged("), "TripNotesPanel never compares before saving")
    assert.ok(/saved: \[notes: string \| null\]/.test(tripNotes), "TripNotesPanel emits no saved")
    assert.ok(/<TripNotesPanel[^>]*@saved=/.test(page), "page ignores the saved notes")
  })
})
