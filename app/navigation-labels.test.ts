import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
}

/**
 * "Passport" used to name three different things: the /passport travel-history
 * page, the identity documents under Settings › Passports, and the nationality
 * picker on Explore. Only the documents keep the word (U11).
 */
describe("passport naming (U11)", () => {
  it("labels the /passport nav entry Travel history on desktop and mobile", () => {
    assert.match(source("./layouts/app.vue"), /to="\/passport"[\s\S]*?<span>Travel history<\/span>/)
    assert.match(
      source("./components/Nav/Mobile.vue"),
      /\{ label: "Travel history", icon: "lucide:stamp", to: "\/passport" \}/,
    )
  })

  it("titles the /passport page Travel history", () => {
    const page = source("./pages/passport.vue")
    assert.match(page, /title: "Travel history"/)
    assert.match(page, /<h1[^>]*>Travel history<\/h1>/)
    assert.doesNotMatch(page, /Travel Passport|Your passport is empty/)
  })

  it("calls the Explore visa selector Nationality", () => {
    const explore = source("./pages/explore.vue")
    assert.match(explore, />Nationality<\/label>/)
    assert.doesNotMatch(explore, />Your passport</)
  })
})
