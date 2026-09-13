import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { createSSRApp, h } from "vue"
import { renderToString } from "vue/server-renderer"
import { VueDraggable } from "vue-draggable-plus"

const source = readFileSync(fileURLToPath(new URL("./DaySection.vue", import.meta.url)), "utf8")

// Two regressions have blanked the activity list, both with the same symptom:
// the day genuinely has activities (the v-if on day.activities.length passes,
// so the rail and the Add activity button render) while the drag list emits
// nothing.
//
// 1. vuedraggable@2.x, npm's `latest` tag, is the Vue 2 build and throws on
//    every render under Vue 3.
// 2. vuedraggable@4.x is a pure Options API component. `future.compatibilityVersion: 5`
//    in nuxt.config.ts resolves `vue.optionsApi` to false, which compiles
//    __VUE_OPTIONS_API__ out of the bundle. Vue then skips applyOptions
//    entirely, so the component's `computed` (realList, getKey) and its
//    `mounted` hook never run while its `render` still does. The list renders
//    empty. Dev warns "Property realList was accessed during render but is not
//    defined on instance"; production strips warnings and fails silently.
//
// The drag component must therefore be Composition API for as long as the app
// runs on compatibility version 5.
describe("DaySection drag list", () => {
  it("uses a drag component that survives the Options API being compiled out", () => {
    const optionsApiOnly = [
      "computed",
      "data",
      "methods",
      "watch",
      "created",
      "beforeMount",
      "mounted",
      "updated",
      "beforeUnmount",
    ]
    const relied = optionsApiOnly.filter((key) => key in VueDraggable)

    assert.deepEqual(
      relied,
      [],
      `drag component relies on Options API options: ${relied.join(", ")}`,
    )
    assert.equal(typeof VueDraggable.setup, "function")
  })

  it("does not import an Options API drag component", () => {
    assert.equal(/from\s+["']vuedraggable["']/.test(source), false, "imports vuedraggable")
    assert.equal(
      /from\s+["']vue-draggable-plus["']/.test(source),
      true,
      "missing vue-draggable-plus",
    )
  })

  it("renders every activity in the drag list", async () => {
    const activities = [
      { id: "a1", name: "Senso-ji Temple" },
      { id: "a2", name: "Nakamise Shopping Street" },
    ]
    const app = createSSRApp({
      render: () =>
        h(
          VueDraggable,
          {
            modelValue: activities,
            "onUpdate:modelValue": () => {},
            handle: ".drag-handle",
            class: "space-y-3",
          },
          () => activities.map((a) => h("div", { key: a.id, id: `activity-${a.id}` }, a.name)),
        ),
    })

    const html = await renderToString(app)
    assert.match(html, /Senso-ji Temple/)
    assert.match(html, /Nakamise Shopping Street/)
    assert.match(html, /space-y-3/)
  })
})
