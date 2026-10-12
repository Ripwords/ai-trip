import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const panel = readFileSync(fileURLToPath(new URL("./ChecklistPanel.vue", import.meta.url)), "utf8")

/** The template picker is the only place a saved template is listed (D3). */
describe("packing template delete", () => {
  it("calls DELETE /api/packing-templates/:id after the app's confirm dialog", () => {
    const fn = panel.slice(panel.indexOf("async function deleteTemplate("))
    assert.ok(fn.length > 0, "deleteTemplate exists")
    const body = fn.slice(0, fn.indexOf("\n}\n"))
    assert.match(body, /await confirm\(\{[\s\S]*destructive: true/)
    assert.match(
      body,
      /\$fetch\(`\/api\/packing-templates\/\$\{template\.id\}`, \{\s*method: "DELETE"/,
    )
    assert.doesNotMatch(panel, /window\.confirm|\balert\(|\bprompt\(/)
  })

  it("offers delete only on the user's own templates, outside the load button", () => {
    assert.match(panel, /v-if="!tmpl\.isGlobal"[\s\S]*?@click="deleteTemplate\(tmpl\)"/)
    const loadButton = panel.match(
      /<button[^>]*@click="loadTemplate\(tmpl\.id\)"[\s\S]*?<\/button>/,
    )
    assert.ok(loadButton)
    assert.doesNotMatch(loadButton[0], /deleteTemplate/)
  })
})
