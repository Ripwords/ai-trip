import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

const page = read("./pages/trips/[id].vue")

const panels = {
  TripNotesPanel: read("./components/TripNotesPanel.vue"),
  ChecklistPanel: read("./components/ChecklistPanel.vue"),
  ExpenseTracker: read("./components/ExpenseTracker.vue"),
  ReservationTracker: read("./components/ReservationTracker.vue"),
}

/** Every `catch` body in a component's script, up to its closing brace. */
function catchBodies(source: string): string[] {
  const script = source.slice(0, source.indexOf("</script>"))
  const bodies: string[] = []
  for (const match of script.matchAll(/catch \(e(?:: unknown)?\) \{/g)) {
    const start = match.index + match[0].length
    let depth = 1
    let i = start
    while (depth > 0 && i < script.length) {
      if (script[i] === "{") depth++
      else if (script[i] === "}") depth--
      i++
    }
    bodies.push(script.slice(start, i - 1))
  }
  return bodies
}

describe("viewers get read-only trip panels (B18)", () => {
  for (const [name, source] of Object.entries(panels)) {
    it(`${name} accepts a readonly prop`, () => {
      assert.ok(/readonly\?: boolean/.test(source), `${name} has no readonly prop`)
    })

    it(`the page passes the viewer role to ${name}`, () => {
      const tag = page.match(new RegExp(`<${name}[\\s\\S]*?/>`))
      assert.ok(tag, `${name} is not rendered on the trip page`)
      assert.ok(tag[0].includes(':readonly="isViewer"'), `${name} is editable for viewers`)
    })

    it(`${name} reports every failed write with a toast`, () => {
      const silent = catchBodies(source).filter(
        (body) => body.includes("console.error") && !/toast/i.test(body),
      )
      assert.deepEqual(silent, [], `${name} has catch blocks that only log`)
    })
  }
})
