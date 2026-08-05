import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
}

const nuxtConfigSource = read("../nuxt.config.ts")
const aiDockSource = read("./components/AiDock.vue")
const tripSettingsSheetSource = read("./components/TripSettingsSheet.vue")
const countryDetailPanelSource = read("./components/CountryDetailPanel.vue")
const tripOverviewSource = read("./components/TripOverview.vue")
const keyboardInsetSource = read("./composables/useKeyboardInset.ts")

// Static (non-`d`) viewport height units resolve against the LARGE viewport on
// mobile Safari/Chrome: they do not shrink when the browser chrome or the
// virtual keyboard appears. Any panel that is pinned to the bottom of the
// screen and sized in `vh` therefore renders taller than the visible area, and
// its footer (in the dock's case, the message composer) ends up underneath the
// keyboard. `dvh` tracks the live viewport and is the only correct unit here.
const STATIC_VH = /(?<![a-z-])\d+(?:\.\d+)?vh/g

// Report the offending declarations rather than dumping the whole file into the
// assertion diff.
function staticVhHits(source: string): string[] {
  return [...source.matchAll(STATIC_VH)].map((m) =>
    source.slice(Math.max(0, m.index - 30), m.index + m[0].length + 10).replace(/\s+/g, " "),
  )
}

describe("mobile viewport", () => {
  it("does not block pinch-zoom in the viewport meta tag", () => {
    const viewportContent = nuxtConfigSource.match(
      /name:\s*"viewport",[\s\S]{0,800}?content:\s*\n?\s*"([^"]+)"/,
    )?.[1]
    assert.ok(viewportContent, "viewport meta tag should declare a content string")
    assert.doesNotMatch(
      viewportContent,
      /maximum-scale|user-scalable\s*=\s*no/,
      "pinch-zoom must stay available (WCAG 1.4.4)",
    )
    assert.match(viewportContent, /viewport-fit=cover/)
  })

  it("forces 16px form controls on touch devices so focus never zooms the page", () => {
    const css = read("./assets/css/tailwind.css")
    assert.match(
      css,
      /@media \(pointer: coarse\) \{[\s\S]*?font-size:\s*16px\s*!important/,
      "the anti-zoom rule must key off pointer coarseness, not viewport width",
    )
  })
})

describe("AI dock (mobile chat sheet)", () => {
  it("sizes the sheet with dynamic viewport units", () => {
    assert.deepEqual(
      staticVhHits(aiDockSource),
      [],
      "the dock sheet must use dvh so the keyboard cannot push the composer off-screen",
    )
    assert.match(aiDockSource, /70dvh/)
    assert.match(aiDockSource, /50dvh/)
  })

  it("lifts the sheet above the iOS keyboard rather than trusting dvh alone", () => {
    // iOS Safari ignores `interactive-widget=resizes-content` and composites the
    // keyboard over the page, so dvh keeps reporting the full screen and the
    // composer ends up behind the keyboard. Only visualViewport reveals this,
    // and only on a real device — headless Chrome cannot reproduce it.
    assert.match(aiDockSource, /useKeyboardInset\(\)/, "must measure the keyboard inset")
    assert.match(
      aiDockSource,
      /bottom:\s*lifted\s*\?/,
      "sheet must be offset by the keyboard inset when one is present",
    )
    assert.match(
      aiDockSource,
      /viewportHeight/,
      "max-height must be derived from the visual viewport, not the layout viewport",
    )
    assert.match(
      keyboardInsetSource,
      /window\.innerHeight\s*-\s*vv\.height\s*-\s*vv\.offsetTop/,
      "inset must account for iOS scrolling the visual viewport (offsetTop)",
    )
    assert.match(
      keyboardInsetSource,
      /vv\.scale\s*>\s*1\.05/,
      "pinch-zoom must not be mistaken for the keyboard",
    )
  })

  it("keeps the desktop side panel free of the mobile inline geometry", () => {
    // Inline styles beat the md: utility classes that position the side panel.
    assert.match(aiDockSource, /if \(!isCompact\.value\) return \{\}/)
    assert.match(aiDockSource, /max-width:\s*767px/)
  })

  it("composes messages in an auto-growing textarea, not a single-line input", () => {
    assert.match(aiDockSource, /<textarea/, "chat composer should be a textarea")
    assert.match(aiDockSource, /rows="1"/, "textarea should start at one row and grow with content")
    assert.match(
      aiDockSource,
      /enter\.exact\.prevent/,
      "Enter sends, Shift+Enter inserts a newline",
    )
  })

  it("keeps the composer text at 16px so iOS never auto-zooms on focus", () => {
    assert.match(aiDockSource, /\.dock-composer\s*\{[^}]*font-size:\s*16px/)
  })

  it("contains scroll inside the message list", () => {
    assert.match(aiDockSource, /\.dock-list\s*\{[^}]*overscroll-behavior:\s*contain/)
  })

  it("locks background scroll while the sheet is open", () => {
    assert.match(aiDockSource, /useBodyScrollLock\(/)
  })
})

describe("primary CTA contrast", () => {
  const css = read("./assets/css/tailwind.css")

  it("defines a CTA fill token that does not mirror in dark mode", () => {
    assert.match(css, /--color-cta:\s*#d44425/, "CTA token must be defined in @theme")
    assert.match(css, /--color-cta-hover:\s*#b0341b/)
    // The .dark block mirrors the terra ramp (400 <-> 600). If --color-cta were
    // redefined there it would flip to a light tint and drop white label text to
    // ~2.7:1, which is exactly the bug this token exists to prevent.
    // Match the `.dark { ... }` rule itself, not the `@custom-variant dark`
    // declaration that also contains the string ".dark".
    const start = css.search(/^\.dark\s*\{/m)
    assert.ok(start > -1, "expected a .dark { } theme block")
    const darkBlock = css.slice(start, start + css.slice(start).indexOf("\n}"))
    assert.doesNotMatch(darkBlock, /--color-cta\b/, "--color-cta must not be re-declared for dark")
    assert.match(darkBlock, /--color-terra-600:\s*#f07b5a/, "sanity: terra does mirror in dark")
  })

  it("never paints white label text on a terra ramp step", () => {
    const appDir = fileURLToPath(new URL(".", import.meta.url))
    const offenders: string[] = []
    for (const file of readdirSync(appDir, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".vue")) continue
      const src = readFileSync(join(appDir, file), "utf8")
      for (const m of src.matchAll(/class="([^"]*)"/g)) {
        const cls = m[1]!
        if (/\btext-white\b/.test(cls) && /\bbg-terra-\d00\b/.test(cls)) {
          offenders.push(`${file}: ${cls.slice(0, 70)}`)
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "white on terra-500 is 3.47:1 and terra-600 flips to 2.73:1 in dark mode; use bg-cta",
    )
  })
})

describe("other bottom sheets and overlays", () => {
  it("size against the dynamic viewport too", () => {
    assert.deepEqual(staticVhHits(tripSettingsSheetSource), [], "TripSettingsSheet.vue")
    assert.deepEqual(staticVhHits(countryDetailPanelSource), [], "CountryDetailPanel.vue")
    assert.deepEqual(staticVhHits(tripOverviewSource), [], "TripOverview.vue")
  })

  it("no component anywhere reaches for a static vh unit", () => {
    const appDir = fileURLToPath(new URL(".", import.meta.url))
    const offenders: string[] = []
    for (const file of readdirSync(appDir, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".vue")) continue
      const hits = staticVhHits(readFileSync(join(appDir, file), "utf8"))
      if (hits.length > 0) offenders.push(`${file}: ${hits.join(" | ")}`)
    }
    assert.deepEqual(offenders, [], "use dvh (or svh/lvh where deliberate), never vh")
  })
})
