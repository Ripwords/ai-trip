import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { visibleTags } from "../utils/visible-tags"

const card = readFileSync(fileURLToPath(new URL("./ActivityCard.vue", import.meta.url)), "utf8")
const template = card.slice(card.indexOf("<template>"))

describe("visibleTags (U6)", () => {
  it("shows every tag when there are two or fewer", () => {
    assert.deepEqual(visibleTags([]), { shown: [], hidden: 0 })
    assert.deepEqual(visibleTags(["a", "b"]), { shown: ["a", "b"], hidden: 0 })
  })

  it("caps at two and counts the rest", () => {
    assert.deepEqual(visibleTags(["a", "b", "c", "d"]), { shown: ["a", "b"], hidden: 2 })
  })

  it("takes a different cap", () => {
    assert.deepEqual(visibleTags(["a", "b", "c"], 1), { shown: ["a"], hidden: 2 })
  })

  it("tolerates a missing list", () => {
    assert.deepEqual(visibleTags(null), { shown: [], hidden: 0 })
  })
})

describe("ActivityCard is decluttered (U6)", () => {
  it("folds edit, assign and delete into one overflow menu", () => {
    assert.ok(/aria-haspopup="menu"/.test(template), "no menu trigger")
    assert.ok(/role="menu"/.test(template), "no menu")
    const items = template.match(/role="menuitem"/g) ?? []
    assert.ok(items.length >= 3, "menu lacks edit / assign / delete items")
    assert.ok(!/title="Edit"/.test(template), "a standalone edit button remains")
    assert.ok(!/title="Delete"/.test(template), "a standalone delete button remains")
    assert.ok(!/title="Assign members"/.test(template), "a standalone assign button remains")
  })

  it("lets the keyboard drive the menu and Esc close it", () => {
    assert.ok(/e\.key === "Escape"/.test(card), "Esc does not close the menu")
    assert.ok(/e\.key === "ArrowDown"/.test(card), "arrow keys do not move through the menu")
    // Keys inside the menu must not reach the card's own Enter/Space handler,
    // nor a page-level Esc shortcut.
    assert.ok(/@keydown\.stop="onMenuKeydown"/.test(template), "menu keys bubble to the card")
  })

  it("caps visible tags at two with a +N count", () => {
    assert.ok(!/tags\.slice\(0, 4\)/.test(template), "still shows four tags")
    assert.ok(/visibleTags\(/.test(card), "tags are not capped")
    assert.ok(/\+\{\{ tags\.hidden \}\}/.test(template), "no +N for hidden tags")
  })

  it("puts price level and the notes marker on the cost meta line", () => {
    const meta = template.match(/<!-- Cost meta[\s\S]*?(?=<!--)/)
    assert.ok(meta, "no single cost meta group")
    assert.ok(/formatPriceLevel/.test(meta[0]), "price level sits apart")
    assert.ok(/activity\.notes/.test(meta[0]), "notes marker sits apart")
  })
})
