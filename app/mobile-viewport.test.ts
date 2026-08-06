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
const dockAnchorSource = read("./utils/dock-anchor.ts")

/**
 * The mobile half of AiDock.vue's stylesheet — everything inside the
 * `@media (max-width: 767px)` block. Extracted so the assertions below can say
 * "the MOBILE dock" and mean it, rather than matching a string that might have
 * come from the desktop side panel's rules.
 */
function mobileDockCss(source: string): string {
  const marker = "@media (max-width: 767px) {"
  let out = ""
  let from = source.indexOf(marker)
  while (from > -1) {
    // Walk braces to find the end of the media block.
    let depth = 0
    let i = from + marker.length - 1
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++
      else if (source[i] === "}" && --depth === 0) break
    }
    out += `${source.slice(from, i + 1)}\n`
    from = source.indexOf(marker, i)
  }
  return out
}

/**
 * Source with comments stripped, so a "this must never come back" guard matches
 * live code rather than the essay explaining why it went away.
 */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** The `class="…"` attribute of the dialog element itself. */
function dockLayerClasses(source: string): string {
  return source.match(/class="(dock-sheet[^"]*)"/)?.[1] ?? ""
}

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

describe("AI dock (mobile full-screen layer)", () => {
  it("sizes the layer with dynamic viewport units", () => {
    assert.deepEqual(
      staticVhHits(aiDockSource),
      [],
      "the dock must use dvh so browser chrome cannot push the composer off-screen",
    )
    assert.match(mobileDockCss(aiDockSource), /height:\s*100dvh/, "the layer fills the viewport")
  })

  it("REGRESSION (#75/#76/#77): the mobile dock is never `position: fixed`", () => {
    // Root cause 1. iOS Safari stops honouring `position: fixed` while the
    // virtual keyboard is up — fixed elements degrade toward `static`. Three
    // shipped attempts adjusted a property (`transform`, then `bottom`, then
    // `top`) on an element whose positioning model Safari had already
    // abandoned; the third measured 0.00px of error in headless Chrome and was
    // still wrong on the device. A fourth positioning fix is not the answer:
    // the mobile dock must not be viewport-pinned at all.
    const mobile = mobileDockCss(aiDockSource)
    assert.match(mobile, /position:\s*absolute/, "the mobile layer is in normal document flow")
    assert.doesNotMatch(mobile, /position:\s*fixed/, "no fixed positioning below md, ever")
    // …and no `fixed` utility class either, which would apply at every width.
    const classes = dockLayerClasses(aiDockSource)
    assert.ok(classes, "expected to find the dock layer's class attribute")
    assert.doesNotMatch(
      classes,
      /(?<![:\w-])fixed\b/,
      "an unprefixed `fixed` utility would pin the layer on mobile too",
    )
    assert.match(classes, /md:fixed/, "the >=768px side panel keeps its fixed positioning")
  })

  it("REGRESSION (#75/#76/#77): no visualViewport-derived positioning anywhere", () => {
    // Root cause 2, and the reason "measure it more precisely" cannot work:
    // iOS's floating accessory bar (the ^ / v / Done pill) is NOT part of
    // `visualViewport.height`. A sheet anchored exactly to the visual
    // viewport's bottom edge still stops above the pill and leaves a visible
    // strip of page. The edge the fixes were aiming at is not reachable through
    // that API, so the dock no longer reads it.
    assert.doesNotMatch(
      code(aiDockSource),
      /visualViewport|useKeyboardInset|resolveDockSheetGeometry/,
      "the dock must not position itself from the visual viewport",
    )
    assert.doesNotMatch(code(dockAnchorSource), /visualViewport/)
    assert.match(
      aiDockSource,
      /resolveDockAnchorTop\(\{\s*scrollY:\s*window\.scrollY/,
      "the layer's only coordinate is a document scroll offset",
    )
    // The reasoning has to stay written down, or attempt #5 gets attempted.
    assert.match(dockAnchorSource, /position: fixed/)
    assert.match(dockAnchorSource, /accessory bar/i)
  })

  it("keeps the composer in flow as the last element of a flex column", () => {
    // The composer is not pinned, not lifted, not transformed. It is the last
    // child of a `flex flex-col` layer whose message list takes the slack, so
    // the browser's own "scroll the focused input into view" is what clears the
    // keyboard — including the accessory bar, because the browser is the one
    // accounting for it.
    assert.match(dockLayerClasses(aiDockSource), /\bflex flex-col\b/)
    assert.match(
      aiDockSource,
      /class="dock-list[^"]*\bmin-h-0 flex-1 overflow-y-auto/,
      "the message list takes the slack and scrolls; min-h-0 is what lets it",
    )
    const layer = aiDockSource.slice(aiDockSource.indexOf('class="dock-sheet'))
    assert.ok(
      layer.indexOf("dock-input-area") > layer.indexOf("dock-list"),
      "the composer must come after the message list in flow order",
    )
    assert.doesNotMatch(
      aiDockSource,
      /dock-input-area[\s\S]{0,200}\b(sticky|fixed|absolute)\b/,
      "the composer area must not be pinned",
    )
  })

  it("does not lock body scroll on mobile, which is what blocked the native scroll-into-view", () => {
    // `useBodyScrollLock` pins `document.body` with `position: fixed` — exactly
    // what stops iOS scrolling the focused composer into view. The full-screen
    // layer covers the viewport, so there is nothing behind it to see move.
    // The >=768px side panel does not cover the page, so it keeps the lock.
    assert.match(
      aiDockSource,
      /useBodyScrollLock\(\(\)\s*=>\s*expanded\.value\s*&&\s*!isCompact\.value\)/,
      "the scroll lock must be desktop-only",
    )
  })

  it("keeps the layer anchored to a document coordinate, not the page top", () => {
    // `position: absolute` resolves against the document, so a bare `top: 0`
    // would park the layer at the top of the trip page and leave it off-screen.
    assert.match(mobileDockCss(aiDockSource), /top:\s*var\(--dock-anchor-top,\s*0px\)/)
    assert.match(
      aiDockSource,
      /"--dock-anchor-top":\s*`\$\{anchorTop\.value\}px`/,
      "the anchor is published as a custom property so it cannot touch md: rules",
    )
    assert.match(
      aiDockSource,
      /window\.scrollTo\(0,\s*y\)/,
      "closing must put the page back where the user opened the dock",
    )
  })

  it("drops the sheet furniture that a full-screen layer cannot honour", () => {
    // A drag handle promises a draggable edge a full-screen layer does not
    // have, and rounded top corners would frame a sliver of nothing.
    assert.doesNotMatch(aiDockSource, /rounded-t-\[/, "no rounded top on the mobile layer")
    assert.match(mobileDockCss(aiDockSource), /border-radius:\s*0/)
    assert.match(
      aiDockSource,
      /md:rounded-3xl/,
      "the desktop side panel keeps its radius — it really is a floating panel",
    )
    assert.doesNotMatch(
      aiDockSource,
      /h-1 w-12 shrink-0 rounded-full/,
      "the drag handle is gone with the sheet",
    )
  })

  it("pads past the notch at the top and the home indicator at the bottom", () => {
    assert.match(mobileDockCss(aiDockSource), /padding-top:\s*env\(safe-area-inset-top/)
    assert.match(
      aiDockSource,
      /\.dock-input-area\s*\{[^}]*padding-bottom:\s*max\(env\(safe-area-inset-bottom/,
      "the composer owns the bottom inset now that it sits on the screen edge",
    )
  })

  it("keeps the slide-up entrance, with nothing left to collide with", () => {
    // Attempts 2 and 3 both broke on `transform`: the lifted sheet needed a
    // permanent translate and the `sheet-up-*` classes own transform for the
    // entrance. With the lift gone, the entrance is the plain slide-up again.
    assert.match(aiDockSource, /<Transition name="sheet-up">/)
    assert.match(
      aiDockSource,
      /\.sheet-up-enter-from,\s*\n\s*\.sheet-up-leave-to \{[^}]*translateY\(100%\)/,
    )
    assert.doesNotMatch(
      aiDockSource,
      /data-vv-anchored/,
      "the anchored-transform frame is gone; nothing may reintroduce it",
    )
    assert.doesNotMatch(
      code(aiDockSource),
      /translateY\(-100%\)/,
      "a lifting transform on the layer is the model this redesign removes",
    )
  })

  it("removed the keyboard-inset machinery rather than leaving it inert", () => {
    for (const gone of [
      "./composables/useKeyboardInset.ts",
      "./composables/useDockSheetGeometry.ts",
    ]) {
      assert.throws(
        () => read(gone),
        /ENOENT/,
        `${gone} positioned the dock from the visual viewport and must not come back`,
      )
    }
  })

  it("throttles the keyboard-driven scroll follow", () => {
    // Still throttled, still keyed off the same intent flags — only its trigger
    // changed, from a stream of visualViewport readings to composer focus and
    // plain resizes.
    assert.match(aiDockSource, /KEYBOARD_SCROLL_THROTTLE_MS/)
    assert.match(aiDockSource, /@focus="onComposerFocus"/)
    assert.match(aiDockSource, /window\.addEventListener\("resize", followKeyboard\)/)
    assert.match(
      aiDockSource,
      /window\.removeEventListener\("resize", followKeyboard\)/,
      "and it must be torn down",
    )
  })

  it("keeps the >=768px side panel out of the mobile layout entirely", () => {
    // The whole mobile layout is inside a compact-only media query, so the side
    // panel is untouched structurally rather than by a runtime guard. The only
    // inline style is a custom property that nothing outside that block reads,
    // so it cannot beat a `md:` utility class the way an inline `top` would.
    const mobile = mobileDockCss(aiDockSource)
    assert.match(mobile, /position:\s*absolute/)
    assert.match(mobile, /height:\s*100dvh/)
    const inlineStyle = aiDockSource.match(
      /const layerStyle = computed<CSSProperties>\([\s\S]*?\)\n/,
    )
    assert.ok(inlineStyle, "expected the layer's inline style to be a single computed")
    assert.match(
      inlineStyle[0],
      /isCompact\.value \? \{ "--dock-anchor-top": [\s\S]*?\} : \{\}/,
      "the desktop panel must receive no inline geometry at all",
    )
    assert.match(aiDockSource, /md:top-4/)
    assert.match(aiDockSource, /md:bottom-4/)
    assert.match(aiDockSource, /md:max-h-\[calc\(100dvh-2rem\)\]/)
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

  it("keeps its dialog semantics — removing the scroll lock must not remove the focus trap", () => {
    assert.match(aiDockSource, /useModalA11y\(dialogRef, \{/)
    assert.match(aiDockSource, /role="dialog"/)
    assert.match(aiDockSource, /aria-modal="true"/)
    assert.match(aiDockSource, /:aria-labelledby="dialogHeadingId"/)
    assert.match(aiDockSource, /onClose:\s*collapse/, "Escape closes the dock")
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
