import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const appSource = readFileSync(fileURLToPath(new URL("./app.vue", import.meta.url)), "utf8")
const nuxtConfigSource = readFileSync(
  fileURLToPath(new URL("../nuxt.config.ts", import.meta.url)),
  "utf8",
)
const splashComponentPath = fileURLToPath(
  new URL("./components/AppSplashScreen.vue", import.meta.url),
)

describe("PWA launch shell", () => {
  it("declares native mobile app launch metadata", () => {
    assert.match(nuxtConfigSource, /name:\s*"apple-mobile-web-app-capable"[\s\S]*?content:\s*"yes"/)
    assert.match(nuxtConfigSource, /name:\s*"mobile-web-app-capable"[\s\S]*?content:\s*"yes"/)
    assert.match(
      nuxtConfigSource,
      /name:\s*"apple-mobile-web-app-title"[\s\S]*?content:\s*"AI Trip"/,
    )
  })

  it("uses auto-update service worker updates and avoids precaching Apple startup images", () => {
    assert.match(nuxtConfigSource, /registerType:\s*"autoUpdate"/)
    assert.match(
      nuxtConfigSource,
      /globIgnores:\s*\[[\s\S]*?"\*\*\/apple-splash-\*\.png"[\s\S]*?\]/,
    )
  })

  it("mounts an app-rendered splashscreen before the routed page", () => {
    assert.ok(existsSync(splashComponentPath), "AppSplashScreen.vue should exist")
    assert.match(appSource, /<AppSplashScreen\s*\/>[\s\S]*?<NuxtRouteAnnouncer/)
  })
})
