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
const dockGeometrySource = read("./composables/useDockSheetGeometry.ts")

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
      /resolveDockSheetGeometry\(\{[\s\S]{0,300}keyboardInset:\s*keyboardInset\.value/,
      "the keyboard verdict must come from the guarded measurement",
    )
    assert.match(
      aiDockSource,
      /resolveDockSheetGeometry\(\{[\s\S]{0,300}viewportBottom:\s*viewportBottom\.value/,
      "the sheet's position must come from the visual viewport's bottom edge",
    )
    assert.match(
      dockGeometrySource,
      /top:\s*`\$\{Math\.round\(anchor\)\}px`/,
      "the sheet's TOP edge must be placed at the visual viewport's bottom edge",
    )
    assert.match(
      keyboardInsetSource,
      /const bottom = s\.offsetTop \+ s\.visualHeight/,
      "the anchor walks DOWN from the layout viewport's top; the sign is the whole bug",
    )
    assert.match(
      aiDockSource,
      /viewportHeight/,
      "max-height must be derived from the visual viewport, not the layout viewport",
    )
    // The measurement rules themselves are unit-tested in
    // composables/useKeyboardInset.test.ts; this only pins that they are still
    // being applied to the real viewport reading.
    assert.match(
      keyboardInsetSource,
      /innerHeight:\s*window\.innerHeight[\s\S]{0,200}offsetTop:\s*vv\.offsetTop/,
      "inset must account for iOS scrolling the visual viewport (offsetTop)",
    )
    assert.match(
      keyboardInsetSource,
      /scale:\s*vv\.scale/,
      "pinch-zoom must not be mistaken for the keyboard",
    )
  })

  it("animates the lift to a settled target instead of sampling every viewport event", () => {
    // iOS emits visualViewport events irregularly during its keyboard
    // animation. Re-styling per event makes the sheet step through whatever
    // coarse frames iOS happened to report — different every time. The lift
    // must instead be one transition to a settled target.
    assert.match(
      aiDockSource,
      /transition:\s*\n?\s*top var\(--dock-lift-ms\) var\(--dock-lift-ease\)/,
      "the lift must be transitioned, not stepped",
    )
    assert.match(
      aiDockSource,
      /max-height var\(--dock-lift-ms\) var\(--dock-lift-ease\)/,
      "height has to change too, so it must share the lift's duration and curve",
    )
  })

  it("anchors by `top`, never by a distance from the bottom (iOS fixed-element bug)", () => {
    // REGRESSION GUARD for PR #75 AND PR #76. iOS Safari stops honouring
    // `position: fixed` while the virtual keyboard is up — fixed elements start
    // behaving like static ones — so ANY lift expressed as a distance from the
    // viewport's bottom edge is measured from an edge Safari is no longer
    // pinning to. #75 did it as `translate3d(0, -inset, 0)` and #76 as
    // `bottom: inset`; both left a band of page above the keyboard that varied
    // per open and grew across open/close cycles.
    //
    // The immune form: put the sheet's TOP edge at
    // `visualViewport.offsetTop + visualViewport.height` and pull it up by its
    // own height. Measured from the layout viewport's top, which does not move.
    assert.doesNotMatch(
      aiDockSource,
      /--dock-lift\s*:|"--dock-lift"/,
      "the lift must not be smuggled back in as a custom property",
    )
    assert.doesNotMatch(
      dockGeometrySource,
      /^\s*bottom:\s*`/m,
      "a `bottom`-based lift is the shipped regression, not the fix",
    )
    // The inline style type admits neither `bottom` (the regression) nor
    // `transform` (inline styles beat classes, and the `sheet-up` classes own
    // transform for the entrance slide).
    const styleShape = dockGeometrySource.match(
      /export type DockSheetGeometry = \{([\s\S]*?)\n\}/,
    )?.[1]
    assert.ok(styleShape, "expected a DockSheetGeometry style type")
    assert.doesNotMatch(
      styleShape,
      /transform/i,
      "the inline style type must never admit transform — it would override sheet-up",
    )
    assert.doesNotMatch(
      styleShape,
      /\bbottom\b/i,
      "the inline style type must never admit bottom — that is the bug this replaced",
    )
    assert.match(styleShape, /top\?:\s*string/, "the anchor is a `top`")
    assert.match(
      dockGeometrySource,
      /position: fixed/,
      "the fixed-becomes-static root cause must stay written down",
    )
    // `will-change: transform` only made sense for the compositor path.
    assert.doesNotMatch(
      aiDockSource,
      /will-change/,
      "no compositor hint is warranted for a layout-driven anchor",
    )
  })

  it("resolves the transform collision instead of letting one side clobber it", () => {
    // The anchored sheet needs a permanent `translateY(-100%)`; the `sheet-up`
    // enter/leave classes own `transform` for the entrance. PR #75 lost the
    // entrance animation to exactly this. Both survive only because the
    // entrance ENDPOINTS are rewritten into the anchored frame, with enough
    // specificity to beat the base anchored rule.
    assert.match(
      aiDockSource,
      /\.dock-sheet\[data-vv-anchored="true"\] \{\s*bottom: auto;\s*transform: translateY\(-100%\);/,
      "the anchored sheet is pulled up by exactly its own height",
    )
    assert.match(
      aiDockSource,
      /\.dock-sheet\[data-vv-anchored="true"\]\.sheet-up-enter-from[\s\S]{0,160}transform: translateY\(0\)/,
      "anchored, the entrance starts one sheet-height BELOW the anchor",
    )
    assert.match(
      aiDockSource,
      /\.dock-sheet\[data-vv-anchored="true"\]\.sheet-up-enter-to[\s\S]{0,160}transform: translateY\(-100%\)/,
      "…and ends at the resting transform, so the travel is unchanged",
    )
    // The flag and the anchor must never disagree: an unanchored sheet carrying
    // translateY(-100%) would sit a full sheet-height above the screen edge.
    assert.match(aiDockSource, /sheetStyle\.value\.top !== undefined/)
    assert.match(aiDockSource, /:data-vv-anchored="sheetAnchored/)
  })

  it("publishes a settled keyboard target rather than every measurement", () => {
    assert.match(
      keyboardInsetSource,
      /const SETTLE_MS/,
      "a burst of visualViewport events must resolve to one target",
    )
    assert.match(
      keyboardInsetSource,
      /scheduleTrailing\(\)/,
      "a single trailing event must still land",
    )
    assert.match(
      keyboardInsetSource,
      /if \(isOpen !== wasOpen\) \{[\s\S]{0,400}commit\(/,
      "an open/close flip must commit immediately so the lift never feels laggy",
    )
    assert.match(
      keyboardInsetSource,
      /composerFocused === false\) return 0/,
      "a blurred composer means no keyboard, whatever iOS 26 reports for offsetTop",
    )
    assert.match(
      keyboardInsetSource,
      /focusin|focusout/,
      "focus is the trustworthy dismissal signal",
    )
  })

  it("throttles the keyboard-driven scroll follow", () => {
    assert.match(aiDockSource, /KEYBOARD_SCROLL_THROTTLE_MS/)
    assert.doesNotMatch(
      aiDockSource,
      /watch\(keyboardInset,\s*\(\)\s*=>\s*\{\s*\n\s*if \(expanded/,
      "scrollToBottom must not run once per viewport measurement",
    )
  })

  it("keeps the desktop side panel free of the mobile inline geometry", () => {
    // Inline styles beat the md: utility classes that position the side panel.
    assert.match(dockGeometrySource, /if \(!input\.isCompact\) return \{\}/)
    assert.match(aiDockSource, /isCompact:\s*isCompact\.value/)
    assert.match(aiDockSource, /max-width:\s*767px/)
    // Belt and braces: the transition that carries the lift is inside a
    // compact-only media query, so even a guard slip cannot reach the panel.
    assert.match(
      aiDockSource,
      /@media \(max-width: 767px\) \{\s*\.dock-sheet \{\s*transition:\s*\n?\s*top/,
    )
    // …and so is the anchored transform, so the md: side panel can never be
    // handed a translateY(-100%) even if `isCompact` were wrong.
    assert.match(
      aiDockSource,
      /@media \(max-width: 767px\) \{[\s\S]{0,600}\.dock-sheet\[data-vv-anchored="true"\] \{/,
    )
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
