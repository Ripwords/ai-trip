import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const layout = readFileSync(fileURLToPath(new URL("./app.vue", import.meta.url)), "utf8")
const theme = readFileSync(
  fileURLToPath(new URL("../assets/css/tailwind.css", import.meta.url)),
  "utf8",
)

/** The ramps `.dark` swaps by reassigning their CSS variables. */
function swappedRamps(): Set<string> {
  const darkBlock = theme.slice(theme.indexOf("\n.dark {"))
  return new Set([...darkBlock.matchAll(/--color-([a-z]+)-\d+:/g)].map((m) => m[1]!))
}

describe("app layout header", () => {
  it("links to no route that does not exist (D1)", () => {
    assert.doesNotMatch(layout, /to="\/admin"/)
  })

  it("offers a Trips link to /dashboard alongside the other header pills (U3)", () => {
    assert.match(
      layout,
      /<NuxtLink[^>]*to="\/dashboard"[^>]*active-class[\s\S]*?<span>Trips<\/span>/,
    )
  })
})
