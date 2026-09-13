import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const card = readFileSync(fileURLToPath(new URL("./FlightCard.vue", import.meta.url)), "utf8")
const theme = readFileSync(
  fileURLToPath(new URL("../assets/css/tailwind.css", import.meta.url)),
  "utf8",
)

/**
 * The ramps the dark theme actually redefines. `.dark` swaps a subset of the
 * palette by reassigning its CSS variables; a ramp outside that set keeps its
 * light value on a dark background.
 */
function swappedRamps(): Set<string> {
  const darkBlock = theme.slice(theme.indexOf("\n.dark {"))
  return new Set([...darkBlock.matchAll(/--color-([a-z]+)-\d+:/g)].map((m) => m[1]!))
}

/** Every colour ramp a Tailwind class list names, `dark:` prefixes included. */
function ramps(classList: string): string[] {
  return [...classList.matchAll(/\b(?:bg|text|border)-([a-z]+)-\d+/g)].map((m) => m[1]!)
}

/**
 * A `dark:` colour utility on a swapped ramp mirrors it twice and lands back
 * where it started.
 *
 * `.dark` already inverts these ramps by reassigning their CSS variables, so
 * `text-amber-700` resolves to #814913 in light and #e8b04a in dark on its own.
 * Adding `dark:text-amber-300` applies a second inversion: amber-300 under
 * `.dark` is #814913, the dark brown. Measured on the #1e1b18 card that is
 * 2.36:1, below even the 3:1 large-text floor, where the bare class would have
 * been 8.77:1.
 *
 * Hence the project rule: on a ramp the theme swaps, name one shade and let the
 * variables do the rest.
 */
describe("FlightCard delay lines", () => {
  const toneClasses = card.match(/:class="note\.tone === 'late' \? '([^']+)' : '([^']+)'"/)

  it("colours both tones from a ramp the dark theme swaps", () => {
    assert.ok(toneClasses, "could not find the delay-note tone classes")
    const swapped = swappedRamps()
    for (const classList of [toneClasses[1]!, toneClasses[2]!]) {
      for (const ramp of ramps(classList)) {
        assert.ok(
          swapped.has(ramp),
          `"${ramp}" is not redefined under .dark, so ${ramp} keeps its light value on a dark card`,
        )
      }
    }
  })

  it("does not re-invert a swapped ramp with a dark: prefix", () => {
    assert.ok(toneClasses)
    for (const classList of [toneClasses[1]!, toneClasses[2]!]) {
      assert.doesNotMatch(classList, /\bdark:/)
    }
  })
})

describe("FlightCard status badges", () => {
  const badgeColors = [...card.matchAll(/\bcolor: "([^"]+)"/g)].map((m) => m[1]!)

  it("reads a colour for every status the card can show", () => {
    // scheduled, delayed, landed, cancelled, and the fallback `statusBadge` uses
    // when the row carries a status none of them names.
    assert.ok(badgeColors.length >= 5, `only found ${badgeColors.length} status badge colours`)
  })

  it("colours every badge from a ramp the dark theme swaps", () => {
    const swapped = swappedRamps()
    for (const classList of badgeColors) {
      for (const ramp of ramps(classList)) {
        assert.ok(
          swapped.has(ramp),
          `"${ramp}" is not redefined under .dark, so ${ramp} keeps its light value on a dark card`,
        )
      }
    }
  })

  it("does not re-invert a swapped ramp with a dark: prefix", () => {
    for (const classList of badgeColors) {
      assert.doesNotMatch(classList, /\bdark:/)
    }
  })
})
