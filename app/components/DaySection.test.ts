import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createSSRApp, h } from "vue"
import { renderToString } from "vue/server-renderer"
import draggable from "vuedraggable"

describe("DaySection drag list", () => {
  // Regression: vuedraggable@2.x (npm's `latest` tag) is the Vue 2 build and
  // throws on every render under Vue 3 (`undefined is not an object
  // (evaluating 'v[k]')` / `Cannot read properties of undefined (reading
  // 'header')`), which blanked the activity list and 500'd trip pages on
  // refresh. The Vue 3 build is 4.x. This mirrors DaySection's usage
  // (v-model + item-key + #item slot) and fails if the dep regresses.
  it("vuedraggable renders a list under Vue 3 with the item-slot API", async () => {
    const activities = [{ id: "a1", name: "Senso-ji Temple" }]
    const app = createSSRApp({
      render: () =>
        h(
          draggable,
          {
            modelValue: activities,
            "onUpdate:modelValue": () => {},
            itemKey: "id",
            handle: ".drag-handle",
            class: "space-y-3",
          },
          { item: ({ element }: { element: { name: string } }) => h("div", element.name) },
        ),
    })

    const html = await renderToString(app)
    assert.match(html, /Senso-ji Temple/)
    assert.match(html, /space-y-3/)
  })
})
