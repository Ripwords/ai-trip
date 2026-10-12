import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

const members = read("./components/TripMembers.vue")
const checklist = read("./components/ChecklistPanel.vue")
const shared = read("./pages/shared/[token].vue")

describe("rows fit a 375px phone (U9)", () => {
  it("TripMembers lets the name column shrink and truncates the email", () => {
    const row = members.slice(members.indexOf("<!-- Active members -->"))
    assert.ok(/class="flex min-w-0 items-center gap-2\.5"/.test(row), "member row lacks min-w-0")
    assert.ok(/<div class="min-w-0">/.test(row), "name/email column cannot shrink")
    assert.ok(/class="truncate text-xs text-sand-500"/.test(row), "email is not truncated")
    assert.ok(/class="flex shrink-0 items-center gap-2"/.test(row), "role controls get squeezed")
  })

  it("ChecklistPanel's header truncates the name and keeps its actions whole", () => {
    const header = checklist.slice(checklist.indexOf("<!-- List header -->"))
    assert.ok(
      /class="flex min-w-0 flex-1 items-center gap-2/.test(header),
      "name button cannot shrink",
    )
    assert.ok(
      /<span class="truncate">\{\{ checklist\.name \}\}<\/span>/.test(header),
      "name not truncated",
    )
    assert.ok(/<div v-if="!readonly" class="flex shrink-0">/.test(header), "actions get squeezed")
  })

  it("the shared page's loading skeleton clips its tab row instead of widening the page", () => {
    assert.ok(
      /<div class="mt-8 flex gap-2 overflow-hidden">/.test(shared),
      "skeleton row overflows",
    )
  })
})
