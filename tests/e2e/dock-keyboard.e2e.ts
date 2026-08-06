/**
 * Real-browser reproduction for the mobile AI dock keyboard bug.
 *
 * Runs the ACTUAL app in WebKit (the closest available engine to iOS Safari)
 * and Chromium (control), opens the AI dock on a real trip page, raises a
 * simulated iOS keyboard, and asserts the composer's bottom edge lands on the
 * visual viewport's bottom edge WITHOUT the user scrolling.
 *
 * Not a `bun test` file on purpose (`.e2e.ts`, not `.test.ts`): it needs a dev
 * server and a database, so it must not run as part of the unit suite.
 *
 * Setup (once):
 *   docker compose -f docker/docker-compose.dev.yml up -d
 *   bunx playwright install webkit chromium
 *   # .env DATABASE_URL must be postgresql://postgres:postgres@localhost/ai_trip
 *   # for the dev server (the ws-proxy path is gated on import.meta.dev), and
 *   # postgresql://postgres:postgres@localhost:5437/ai_trip for drizzle-kit.
 *
 * Run:
 *   PORT=3111 bunx nuxt dev --https        # in another shell; see BASE_URL below
 *   bun tests/e2e/dock-keyboard.e2e.ts
 *
 * Env:
 *   E2E_BASE_URL       default https://localhost:3111
 *   E2E_DATABASE_URL   default postgresql://postgres:postgres@localhost:5437/ai_trip
 *   BETTER_AUTH_SECRET required (from .env) — used to sign the session cookie
 *   E2E_BROWSERS       default "webkit,chromium"
 *   E2E_SCREENSHOT_DIR default ./tests/e2e/screenshots
 */
import { chromium, webkit, type Browser, type BrowserContext, type Page } from "playwright"
import { Pool } from "pg"
import { mkdir } from "node:fs/promises"
import { installKeyboardSim, readDockGeometry, type KeyboardWindow } from "./keyboard-sim"

/**
 * HTTPS on purpose. nuxt-security sends `upgrade-insecure-requests`; WebKit
 * honours it on localhost (Chromium exempts localhost), so over plain HTTP
 * WebKit upgrades every module request to https, they all fail, and the app
 * never hydrates. Production is HTTPS anyway, so the dev server must be too:
 *   PORT=3111 bunx nuxt dev --https
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "https://localhost:3111"
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5437/ai_trip"
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR ?? "tests/e2e/screenshots"
const SESSION_ID = "e2e-dock-session"
const SESSION_TOKEN = "e2e-dock-token-1"

/** iPhone 14/15-class layout viewport. */
const PHONE = { width: 390, height: 844 }
/** Roughly an iOS keyboard with the predictive bar, portrait. */
const KEYBOARD_PX = 336
/** The composer's bottom edge must land within this many px of the target. */
const TOLERANCE_PX = 2

type Failure = { engine: string; check: string; detail: string }
const failures: Failure[] = []
const log: string[] = []

function record(engine: string, check: string, ok: boolean, detail: string): void {
  const line = `  ${ok ? "PASS" : "FAIL"}  [${engine}] ${check} — ${detail}`
  log.push(line)
  console.log(line)
  if (!ok) failures.push({ engine, check, detail })
}

/** better-call's `signCookieValue`: `token.base64(HMAC-SHA256(secret, token))`, URI-encoded. */
async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
  return encodeURIComponent(`${value}.${base64}`)
}

/**
 * Finds a trip that actually renders the dock (owner + itinerary days) and
 * upserts a session row for its owner. Idempotent.
 */
async function bootstrapSession(): Promise<{ tripId: string; cookieValue: string }> {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set (source .env first)")
  if (DATABASE_URL.includes("neon.tech")) throw new Error("refusing to run against Neon")

  const pool = new Pool({ connectionString: DATABASE_URL })
  try {
    const trip = await pool.query<{ id: string; user_id: string }>(
      `select t.id, t.user_id
         from trips t
         join itinerary_days d on d.trip_id = t.id
        group by t.id, t.user_id
       having count(d.id) > 0
        order by count(d.id) desc
        limit 1`,
    )
    const row = trip.rows[0]
    if (!row) throw new Error("no trip with itinerary days in the local database")

    await pool.query(
      `insert into session (id, user_id, token, expires_at, created_at, updated_at)
       values ($1, $2, $3, now() + interval '30 days', now(), now())
       on conflict (id) do update
         set user_id = excluded.user_id,
             token = excluded.token,
             expires_at = excluded.expires_at`,
      [SESSION_ID, row.user_id, SESSION_TOKEN],
    )
    return { tripId: row.id, cookieValue: await signCookieValue(SESSION_TOKEN, secret) }
  } finally {
    await pool.end()
  }
}

async function openDock(page: Page, tripId: string): Promise<void> {
  // The page opens on the Overview tab and restores the last tab from
  // sessionStorage on mount; the dock only exists on Itinerary.
  await page.addInitScript((id: string) => {
    sessionStorage.setItem(`trip-${id}-tab`, "itinerary")
  }, tripId)
  await page.goto(`${BASE_URL}/trips/${tripId}`, { waitUntil: "domcontentloaded" })
  const fab = page.locator('button[title="Discuss with AI"]')
  await fab.waitFor({ state: "visible", timeout: 60_000 })
  await fab.click()
  await page.locator(".dock-sheet").waitFor({ state: "visible", timeout: 10_000 })
  // Let the entrance transition settle so measurements are of the resting state.
  await page.waitForTimeout(500)
}

async function runEngine(browser: Browser, engine: string, tripId: string, cookie: string) {
  const context: BrowserContext = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    // The dev server's certificate is self-signed.
    ignoreHTTPSErrors: true,
  })
  await context.addCookies([
    { name: "ai-trip.session_token", value: cookie, url: BASE_URL, httpOnly: true },
  ])
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  await page.addInitScript(installKeyboardSim)

  try {
    await openDock(page, tripId)

    // ── Baseline, keyboard down ──────────────────────────────────────
    const before = await page.evaluate(readDockGeometry)
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${engine}-1-keyboard-down.png` })
    record(
      engine,
      "entrance: layer fills the viewport with the keyboard down",
      Math.abs(before.composerBottom - before.visualViewportBottom) <= TOLERANCE_PX,
      `composerBottom=${before.composerBottom.toFixed(2)} vvBottom=${before.visualViewportBottom.toFixed(2)} layerH=${before.layerHeight.toFixed(2)}`,
    )
    record(
      engine,
      "#79 invariant: document is exactly one viewport tall",
      before.scrollHeight === before.innerHeight,
      `scrollHeight=${before.scrollHeight} innerHeight=${before.innerHeight}`,
    )

    // ── Focus the composer, then raise the keyboard ──────────────────
    await page.locator(".dock-composer").focus()
    await page.evaluate((k) => {
      ;(window as KeyboardWindow).__simulateKeyboard?.(k)
    }, KEYBOARD_PX)
    await page.waitForTimeout(400)

    const after = await page.evaluate(readDockGeometry)
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${engine}-2-keyboard-up.png` })

    const delta = after.composerBottom - after.visualViewportBottom
    record(
      engine,
      "THE ASSERTION: composer sits on the keyboard",
      Math.abs(delta) <= TOLERANCE_PX,
      `composerBottom=${after.composerBottom.toFixed(2)} vvBottom=${after.visualViewportBottom.toFixed(2)} ` +
        `off by ${delta.toFixed(2)}px (${delta > 0 ? "BEHIND the keyboard" : "above the keyboard"})`,
    )
    record(
      engine,
      "no user scrolling was required",
      after.scrollY === 0,
      `scrollY=${after.scrollY}`,
    )
    record(
      engine,
      "#79 invariant still holds with the keyboard up",
      after.scrollHeight <= after.innerHeight,
      `scrollHeight=${after.scrollHeight} innerHeight=${after.innerHeight}`,
    )

    // ── iOS may also shift the visual viewport down ──────────────────
    await page.evaluate((k) => {
      ;(window as KeyboardWindow).__simulateKeyboard?.(k, 24)
    }, KEYBOARD_PX)
    await page.waitForTimeout(300)
    const shifted = await page.evaluate(readDockGeometry)
    record(
      engine,
      "composer follows a shifted visual viewport (offsetTop=24)",
      Math.abs(shifted.composerBottom - shifted.visualViewportBottom) <= TOLERANCE_PX,
      `composerBottom=${shifted.composerBottom.toFixed(2)} vvBottom=${shifted.visualViewportBottom.toFixed(2)}`,
    )

    // ── Keyboard down again ──────────────────────────────────────────
    await page.evaluate(() => {
      ;(window as KeyboardWindow).__simulateKeyboard?.(0, 0)
    })
    await page.waitForTimeout(300)
    const restored = await page.evaluate(readDockGeometry)
    record(
      engine,
      "layer returns to full height when the keyboard closes",
      Math.abs(restored.layerHeight - restored.innerHeight) <= TOLERANCE_PX,
      `layerH=${restored.layerHeight.toFixed(2)} innerHeight=${restored.innerHeight}`,
    )

    // ── Closing restores the page ────────────────────────────────────
    await page.locator('button[aria-label="Close"]').click()
    await page.waitForTimeout(500)
    const closed = await page.evaluate(() => ({
      collapsed: document.documentElement.classList.contains("dock-page-collapsed"),
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      pageVisible: (() => {
        const el = document.querySelector("[data-dock-page-content]")
        return el ? el.getBoundingClientRect().height > 0 : false
      })(),
    }))
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${engine}-3-closed.png` })
    record(
      engine,
      "closing restores page scroll and layout",
      !closed.collapsed && closed.pageVisible && closed.scrollHeight > closed.innerHeight,
      `collapsed=${closed.collapsed} pageHeight>0=${closed.pageVisible} scrollHeight=${closed.scrollHeight}`,
    )

    // ── Desktop must be unaffected ───────────────────────────────────
    const desktop = await context.newPage()
    await desktop.setViewportSize({ width: 1280, height: 800 })
    await desktop.addInitScript(installKeyboardSim)
    await openDock(desktop, tripId)
    const desktopGeometry = await desktop.evaluate(() => {
      const layer = document.querySelector(".dock-sheet")
      if (!layer) throw new Error("dock is not open")
      const rect = layer.getBoundingClientRect()
      const pageContent = document.querySelector("[data-dock-page-content]")
      return {
        position: getComputedStyle(layer).position,
        width: rect.width,
        height: rect.height,
        collapsed: document.documentElement.classList.contains("dock-page-collapsed"),
        pageHeight: pageContent ? pageContent.getBoundingClientRect().height : 0,
      }
    })
    await desktop.screenshot({ path: `${SCREENSHOT_DIR}/${engine}-4-desktop.png` })
    record(
      engine,
      "desktop >=768px unaffected (fixed 400px side panel, page left in layout)",
      desktopGeometry.position === "fixed" &&
        Math.round(desktopGeometry.width) === 400 &&
        !desktopGeometry.collapsed &&
        desktopGeometry.pageHeight > 0,
      `position=${desktopGeometry.position} width=${desktopGeometry.width} height=${desktopGeometry.height.toFixed(0)} collapsed=${desktopGeometry.collapsed} pageHeight=${desktopGeometry.pageHeight.toFixed(0)}`,
    )
    await desktop.close()
  } finally {
    await context.close()
  }
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true })
  const { tripId, cookieValue } = await bootstrapSession()
  console.log(
    `\nTrip: ${tripId}\nBase: ${BASE_URL}\nKeyboard: ${KEYBOARD_PX}px on a ${PHONE.width}x${PHONE.height} phone\n`,
  )

  const wanted = (process.env.E2E_BROWSERS ?? "webkit,chromium").split(",").map((s) => s.trim())
  for (const engine of wanted) {
    const launcher = engine === "webkit" ? webkit : engine === "chromium" ? chromium : null
    if (!launcher) throw new Error(`unknown engine: ${engine}`)
    console.log(`\n── ${engine} ${"─".repeat(50)}`)
    const browser = await launcher.launch()
    try {
      await runEngine(browser, engine, tripId, cookieValue)
    } finally {
      await browser.close()
    }
  }

  console.log(`\n${"═".repeat(64)}`)
  if (failures.length > 0) {
    console.log(`${failures.length} CHECK(S) FAILED`)
    for (const f of failures) console.log(`  [${f.engine}] ${f.check}: ${f.detail}`)
    process.exit(1)
  }
  console.log("ALL CHECKS PASSED")
}

await main()
