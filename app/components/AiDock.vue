<script setup lang="ts">
import { BorderBeam } from "vue-border-beam"
import { marked } from "marked"
import DOMPurify from "dompurify"
import type { CSSProperties } from "vue"
import type { Proposal } from "~/types/proposal"

marked.setOptions({ gfm: true, breaks: true })

let domPurifyHookRegistered = false
function ensureDomPurifyHook() {
  if (domPurifyHookRegistered) return
  // Force all rendered links to open in a new tab without leaking opener.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank")
      node.setAttribute("rel", "noopener noreferrer")
    }
  })
  domPurifyHookRegistered = true
}

// Streaming replaces `aiMessages.value` once per `text` delta (~per token),
// which changes the prop array identity and re-runs the whole `v-for` render
// function — so an unmemoized parse+sanitize here becomes O(tokens *
// messages) instead of O(messages). Cache keyed by message id (not by the
// content string) so a message that is still streaming — whose content
// changes every token — overwrites its OWN single cache entry instead of
// growing the cache by one per token. Bounded with simple oldest-first
// eviction (Map preserves insertion order) so a very long session still
// can't grow this unboundedly.
const MARKDOWN_CACHE_LIMIT = 50
const markdownCache = new Map<string, { content: string; html: string }>()

function renderMarkdown(id: string, content: string): string {
  const cached = markdownCache.get(id)
  if (cached && cached.content === content) return cached.html

  ensureDomPurifyHook()
  const html = marked.parse(content, { async: false }) as string
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "del",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
  })

  markdownCache.set(id, { content, html: sanitized })
  if (markdownCache.size > MARKDOWN_CACHE_LIMIT) {
    const oldestKey = markdownCache.keys().next().value
    if (oldestKey !== undefined) markdownCache.delete(oldestKey)
  }
  return sanitized
}

export type ChatRole = "user" | "assistant" | "system"

export interface ChatMessage {
  id: string
  /**
   * The id of the persisted transcript row, when there is one. Apply/Dismiss
   * are recorded against it; a message with none (a local system line, or a
   * turn that was not persisted) simply has no state to remember.
   */
  serverId?: string
  role: ChatRole
  content: string
  toolCallSummary?: string[]
  proposals?: Proposal[]
  proposalStates?: Record<string, "pending" | "applying" | "applied" | "dismissed">
  /**
   * Proposals a later edit to their day has overtaken, from the server. A
   * superseded card is shown but not actionable: applying it would re-run a
   * suggestion made against an itinerary that has since moved on, and undoing
   * it would restore a snapshot from before those later edits.
   */
  proposalSuperseded?: Record<string, boolean>
  /**
   * Proposals this browser session applied and still holds an undo snapshot
   * for. Undo posts a snapshot captured in memory at apply time, so it is
   * offered only where that snapshot really exists — never on a card restored
   * from a previous session, where the button would do nothing at all.
   */
  proposalUndoable?: Record<string, boolean>
  /**
   * Live reasoning from thinking mode. Display-only and never persisted — the
   * server does not store it and a reloaded transcript will not have it.
   */
  thinkingText?: string
  timestamp: number
}

const props = defineProps<{
  messages: ChatMessage[]
  input: string
  loading: boolean
  usageUsed: number | null
  usageLimit: number | null
  usageRemaining: number | null
  hasActivities: boolean
  destination: string
  starters: string[]
  dayLabels: Record<string, string>
  thinking: boolean
  thinkingAvailable: boolean
}>()

const emit = defineEmits<{
  "update:input": [value: string]
  submit: [text: string]
  cancel: []
  applyProposal: [messageId: string, proposal: Proposal]
  dismissProposal: [messageId: string, proposalId: string]
  applyGroup: [messageId: string, proposals: Proposal[]]
  dismissGroup: [messageId: string, proposalIds: string[]]
  undo: [dayId: string]
  fillGaps: []
  optimizeRoute: []
  generateFull: []
  "update:thinking": [value: boolean]
  close: []
  clear: []
}>()

const inputEl = ref<HTMLTextAreaElement | null>(null)
const expanded = ref(false)
const listEl = ref<HTMLElement | null>(null)
const userScrolledUp = ref(false)
const newReplyPending = ref(false)

function expand() {
  expanded.value = true
  // (`expanded` may also be set by the loading watcher below, so everything
  // that must happen on open — the layer's document anchor — hangs off a
  // watcher on `expanded`, not off this function.)
  // Double tick so this runs strictly AFTER useModalA11y's own open-focus
  // (which focuses the first focusable node — a header button) so the
  // text input keeps initial focus on open.
  nextTick(() => nextTick(() => inputEl.value?.focus()))
  // Chat history is restored from the server, so reopening the dock can mount a
  // transcript that is already taller than the list. The autoscroll watcher only
  // fires when a message CHANGES, and nothing changes on open — so without this
  // the sheet opens parked at the oldest message. Jump (no smooth scroll: there
  // is nothing to follow, the newest reply should simply be what you see).
  nextTick(() => scrollToBottom(false))
}

function collapse() {
  if (props.loading) emit("cancel")
  emit("close")
  expanded.value = false
}

// Dialog accessibility: Escape-to-close + focus-restore to the FAB on close.
const dialogRef = ref<HTMLElement | null>(null)
const dialogHeadingId = useId()
useModalA11y(dialogRef, {
  isOpen: () => expanded.value,
  onClose: collapse,
})

// ── Viewport class ──────────────────────────────────────────────────
// Below `md` the dock is a full-screen layer in normal document flow; at and
// above it, a right-anchored side panel positioned entirely by `md:` utility
// classes. The two are separated structurally — the mobile layout lives inside
// a `@media (max-width: 767px)` block in the stylesheet, and the only inline
// style is a custom property that nothing outside that block reads — so the
// desktop panel cannot be reached by any of it. This flag exists only for the
// couple of JS behaviours that differ.
const isCompact = ref(true)
let compactQuery: MediaQueryList | null = null
function syncCompact(e: MediaQueryList | MediaQueryListEvent) {
  isCompact.value = e.matches
  // A rotation across the breakpoint mid-conversation swaps the layer for the
  // side panel (or back); the page collapse has to follow it, or the desktop
  // panel would be left sitting on a page that has no height.
  syncPageCollapse()
  syncViewportHeight()
}

// Scroll lock: DESKTOP ONLY, deliberately.
//
// On the side panel it still makes sense — the page is not meant to move while
// a modal dialog owns focus, and the panel does not cover it.
//
// On mobile it was actively causing the bug. The lock pins `document.body` with
// `position: fixed`, which is precisely what stops iOS from scrolling the
// focused composer into view; every keyboard fix so far was hand-rolling, badly,
// the scroll the browser was being prevented from doing itself. The full-screen
// layer covers the viewport, so there is nothing behind it to see scroll anyway.
useBodyScrollLock(() => expanded.value && !isCompact.value)

// ── The full-screen layer's document anchor (mobile only) ───────────
// The layer is `position: absolute; height: 100dvh` — NOT fixed. `absolute`
// resolves against the document, so it needs the scroll offset the dock opened
// at in order to cover the viewport. See `resolveDockAnchorTop` for why the
// whole viewport-pinned model was abandoned. This is a scroll coordinate; no
// `visualViewport` property is read anywhere in this component.
const anchorTop = ref(0)
let restoreScrollY: number | null = null

// ── Collapsing the document to one viewport (mobile only) ───────────
// #78 let iOS scroll the focused composer into view again (the mobile scroll
// lock was what had been preventing it). It then overshot by ~190px on iOS 26,
// parking the composer well ABOVE the accessory bar: the layer is `absolute`
// over a document that still contained the whole trip page, so there were
// thousands of pixels of scroll range and nothing capping how far the
// scroll-into-view could travel.
//
// The cap has to be structural. While the layer is open the trip page is taken
// OUT OF LAYOUT — `height: 0; overflow: hidden` on its wrapper — so the
// document is exactly one viewport tall and the only movement left is the
// keyboard's own offset. Do not put scrollable room back underneath the layer.
//
// Out of layout, not out of the tree: the wrapper keeps its box clipped rather
// than removed, so every component inside stays mounted with its state, and
// (unlike `display: none`) their own boxes keep their sizes — the Google map
// never sees a 0x0 container and so never has to re-render on close.
const DOCK_PAGE_COLLAPSED_CLASS = "dock-page-collapsed"

function syncPageCollapse() {
  if (!import.meta.client) return
  document.documentElement.classList.toggle(
    DOCK_PAGE_COLLAPSED_CLASS,
    expanded.value && isCompact.value,
  )
}

// ── The layer's height follows the VISIBLE viewport (mobile only) ───
// #79 removed the overshoot and left the opposite failure: nothing moved the
// composer at all. Both follow from the same thing — the layer being a fixed
// `100dvh` regardless of what is actually visible. `100dvh` does not shrink for
// the virtual keyboard on iOS (`dvh` tracks retractable browser chrome, not the
// keyboard), so the layer stays screen-tall, its last flow child — the composer
// — sits at the SCREEN's bottom, and the keyboard covers it. With the document
// capped at one viewport there is no scroll range left for iOS to reveal it
// with either, so it just stays there.
//
// So the layer stops being screen-tall and becomes visible-strip-tall:
// `visualViewport.offsetTop + visualViewport.height`, i.e. its bottom edge is
// the visible region's bottom edge. The composer, still just the last flow
// child, lands on top of the keyboard by ordinary block layout.
//
// Yes, this reads `visualViewport` again, which #75/#77 did. The difference is
// what it feeds: this is the HEIGHT of an element in normal document flow, not
// the POSITION of a `position: fixed` one. Those attempts failed because iOS
// stops honouring fixed positioning while the keyboard is up (fixed elements
// degrade toward static), so their corrections were applied in a coordinate
// space Safari had abandoned. Nothing here is pinned to a viewport edge: the
// layer is still `position: absolute` at a DOCUMENT coordinate, and heights of
// in-flow boxes are not subject to that degradation. And because the document
// is exactly as tall as the layer, shrinking the layer shrinks the document
// with it — so the scroll range stays zero and #78's overshoot cannot return.
const viewportHeight = ref<number | null>(null)

/**
 * Pinch-zoom also shrinks `visualViewport.height`. Above this scale the reading
 * is a zoom, not a keyboard, and resizing the layer for it would be wrong.
 */
const MAX_TRACKED_SCALE = 1.05

function syncViewportHeight() {
  if (!import.meta.client) return
  const vv = window.visualViewport
  if (!vv || !expanded.value || !isCompact.value || vv.scale > MAX_TRACKED_SCALE) {
    // Null drops the custom property entirely, so the stylesheet's `100dvh`
    // fallback applies — the desktop panel and the closed state are untouched.
    viewportHeight.value = null
    return
  }
  viewportHeight.value = Math.round(vv.offsetTop + vv.height)
}

const layerStyle = computed<CSSProperties>(() => {
  if (!isCompact.value) return {}
  const style: CSSProperties = { "--dock-anchor-top": `${anchorTop.value}px` }
  if (viewportHeight.value !== null) {
    style["--dock-viewport-height"] = `${viewportHeight.value}px`
  }
  return style
})

/** Re-derive the anchor once the layer is in the DOM and its offset parent known. */
function measureAnchor() {
  const el = dialogRef.value
  if (!el) return
  const parent = el.offsetParent as HTMLElement | null
  const containingBlockTop = parent ? parent.getBoundingClientRect().top + window.scrollY : 0
  // While the page is collapsed the document IS the layer, so 0 is the only
  // scroll offset it can have — and the anchor must be derived from that, not
  // from a live `window.scrollY` reading. Chromium had not finished clamping
  // the old offset by the time this ran, so the layer was anchored 456px down,
  // which made the document 456px TALLER than the viewport and handed back
  // exactly the scroll range the collapse exists to remove. (WebKit clamps
  // synchronously and read 0, so the two engines disagreed.) Anchoring at 0 is
  // self-correcting: the document then cannot be taller than one viewport, so
  // nothing — not a focus scroll, not a scroll-into-view — can move it.
  const collapsed = document.documentElement.classList.contains(DOCK_PAGE_COLLAPSED_CLASS)
  anchorTop.value = resolveDockAnchorTop({
    scrollY: collapsed ? 0 : window.scrollY,
    containingBlockTop,
  })
}

watch(expanded, (open) => {
  if (!import.meta.client) return
  if (open) {
    if (!isCompact.value) return
    // Read the scroll offset FIRST: collapsing the page shrinks the document to
    // one viewport, which clamps `window.scrollY` to 0 — save it afterwards and
    // there is nothing left to save.
    restoreScrollY = window.scrollY
    syncPageCollapse()
    // Collapsing the page SHOULD clamp `scrollY` to 0 — but only WebKit does it
    // synchronously. Chromium leaves the old offset in place long enough for
    // `measureAnchor` to read it, which anchors the layer at (say) 456px, makes
    // the document 456 + 100dvh tall and hands the scroll range back that the
    // collapse exists to remove. While the layer is open the document is the
    // layer, so 0 is the only correct scroll offset: say so rather than hoping.
    window.scrollTo(0, 0)
    // With the page out of layout the document starts at 0, so the layer sits
    // at the document origin. Set pre-flush so its first paint is already in
    // the right place, then re-derive once the collapse has been laid out and
    // the layer's offset parent is known.
    anchorTop.value = 0
    syncViewportHeight()
    nextTick(measureAnchor)
    // (Closing is handled below without the compact check, so a rotation to the
    // side panel mid-conversation cannot strand a saved scroll position.)
  } else {
    // Closing. Put the page back in layout first — `scrollTo` is clamped to the
    // document's height, so restoring while it is still one viewport tall would
    // quietly land on 0 and lose the user's place.
    syncPageCollapse()
    syncViewportHeight()
    if (restoreScrollY !== null) {
      const y = restoreScrollY
      restoreScrollY = null
      nextTick(() => window.scrollTo(0, y))
    }
  }
})

// Keep the newest message in view when the keyboard appears. Throttled: leading
// so the list follows straight away, trailing so it lands again once iOS has
// finished scrolling the composer into view. (The scroll policy itself — the
// bottom threshold, the user-intent flag — is untouched.)
const KEYBOARD_SCROLL_THROTTLE_MS = 250
let keyboardScrollAt = 0
let keyboardScrollTimer: ReturnType<typeof setTimeout> | null = null

function followKeyboard() {
  const run = () => {
    keyboardScrollAt = Date.now()
    if (expanded.value && !userScrolledUp.value) nextTick(() => scrollToBottom(false))
  }
  if (Date.now() - keyboardScrollAt >= KEYBOARD_SCROLL_THROTTLE_MS) run()
  if (keyboardScrollTimer) clearTimeout(keyboardScrollTimer)
  keyboardScrollTimer = setTimeout(() => {
    keyboardScrollTimer = null
    run()
  }, KEYBOARD_SCROLL_THROTTLE_MS)
}

/**
 * How long to let iOS finish its own keyboard-dismissal scroll before checking
 * whether it left the layer's header above the top of the screen.
 */
const REALIGN_DELAY_MS = 300
let realignTimer: ReturnType<typeof setTimeout> | null = null

/**
 * The keyboard scrolled the DOCUMENT to reveal the composer (which is the whole
 * point — it is the browser doing the work instead of us). Safari usually
 * scrolls back on dismissal; when it does not, the layer's header is left above
 * the viewport. Nudge the document back to the layer's own top edge — a
 * document coordinate, not a viewport-derived offset, and never a reposition of
 * the layer itself.
 */
function realignAfterKeyboard() {
  if (realignTimer) clearTimeout(realignTimer)
  realignTimer = setTimeout(() => {
    realignTimer = null
    const el = dialogRef.value
    if (!el || !expanded.value || !isCompact.value) return
    const top = el.getBoundingClientRect().top
    if (top < -8) window.scrollTo(0, window.scrollY + top)
  }, REALIGN_DELAY_MS)
}

onMounted(() => {
  if (!import.meta.client) return
  compactQuery = window.matchMedia("(max-width: 767px)")
  syncCompact(compactQuery)
  compactQuery.addEventListener("change", syncCompact)
  // Orientation changes and (on Android) the layout viewport shrinking for the
  // keyboard both arrive as a plain resize.
  window.addEventListener("resize", followKeyboard)
  window.addEventListener("resize", syncViewportHeight)
  // iOS announces the keyboard ONLY here: `innerHeight` does not change and no
  // `resize` fires on `window`. `scroll` too, because the visual viewport can
  // move without changing size.
  window.visualViewport?.addEventListener("resize", onVisualViewportChange)
  window.visualViewport?.addEventListener("scroll", onVisualViewportChange)
})

function onVisualViewportChange() {
  syncViewportHeight()
  followKeyboard()
}

onBeforeUnmount(() => {
  compactQuery?.removeEventListener("change", syncCompact)
  if (import.meta.client) {
    window.removeEventListener("resize", followKeyboard)
    window.removeEventListener("resize", syncViewportHeight)
    window.visualViewport?.removeEventListener("resize", onVisualViewportChange)
    window.visualViewport?.removeEventListener("scroll", onVisualViewportChange)
    // The flag lives on <html>, outside this component's tree, so unmounting
    // while open (switching tabs, leaving the trip) would otherwise leave the
    // page permanently collapsed.
    document.documentElement.classList.remove(DOCK_PAGE_COLLAPSED_CLASS)
  }
  if (keyboardScrollTimer) clearTimeout(keyboardScrollTimer)
  if (realignTimer) clearTimeout(realignTimer)
})

// ── Composer sizing ─────────────────────────────────────────────────
// A single-line input made long messages unreadable on a phone (you could only
// ever see the tail of what you typed). Grow the textarea with its content up
// to a cap, past which it scrolls internally so the sheet layout stays stable.
const COMPOSER_MAX_HEIGHT_PX = 120

function resizeComposer() {
  const el = inputEl.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`
}

function onComposerInput(event: Event) {
  emit("update:input", (event.target as HTMLTextAreaElement).value)
}

function onComposerFocus() {
  followKeyboard()
}

function onComposerBlur() {
  followKeyboard()
  realignAfterKeyboard()
}

// Covers the paths that change `input` without a keystroke: starter chips,
// parent clearing it after submit.
watch(
  () => props.input,
  () => nextTick(resizeComposer),
)

const limitReached = computed(() => (props.usageRemaining ?? 1) <= 0)

const placeholder = computed(() => {
  if (limitReached.value) return "Limit reached. Resets next month."
  if (props.loading) return "Thinking..."
  return "Ask, discuss, or push back..."
})

function handleSubmit() {
  if (props.loading || !props.input.trim() || limitReached.value) return
  emit("submit", props.input.trim())
}

function handleSendClick() {
  if (props.loading) {
    emit("cancel")
  } else {
    handleSubmit()
  }
}

function selectStarter(text: string) {
  emit("update:input", text)
  nextTick(() => inputEl.value?.focus())
}

// ── Scroll behavior ─────────────────────────────────────────────────

function isAtBottom() {
  const el = listEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 24
}

function scrollToBottom(smooth = true) {
  const el = listEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" })
  userScrolledUp.value = false
  newReplyPending.value = false
}

function onListScroll() {
  if (!listEl.value) return
  userScrolledUp.value = !isAtBottom()
  if (!userScrolledUp.value) newReplyPending.value = false
}

// Streaming mutates the LAST message in place (empty bubble -> tool lines ->
// text deltas) without changing `messages.length`, so length alone can't
// drive autoscroll anymore — a long reply would stream entirely below the
// fold. Watch a cheap derived signal instead: a string built from three
// O(1) property reads (message count, last message's content length, last
// message's tool-line count). This fires on every token like the old
// length-only watcher did on every new message, but stays O(1) per fire —
// no deep watch of the array or its content strings.
const lastMessageProgress = computed(() => {
  const last = props.messages[props.messages.length - 1]
  return `${props.messages.length}:${last?.content.length ?? 0}:${last?.toolCallSummary?.length ?? 0}`
})

watch(lastMessageProgress, () => {
  if (userScrolledUp.value) {
    newReplyPending.value = true
  } else {
    nextTick(() => scrollToBottom())
  }
})

// Rotating hints shown in the assistant bubble during the gap before the first
// tool line or text token arrives — a turn that calls tools before replying can
// sit silent for a few seconds, and an empty bubble reads as frozen. Real tool
// activity (searchPlaces, getDistance) replaces this the moment it streams.
const THINKING_HINTS = [
  "Reading your trip…",
  "Thinking it through…",
  "Checking your schedule…",
  "Working on your reply…",
]
const thinkingHintIndex = ref(0)
const thinkingText = computed(() => THINKING_HINTS[thinkingHintIndex.value % THINKING_HINTS.length])
let thinkingTimer: ReturnType<typeof setInterval> | null = null

watch(
  () => props.loading,
  (isLoading) => {
    if (isLoading) {
      expanded.value = true
      thinkingHintIndex.value = 0
      thinkingTimer ??= setInterval(() => {
        thinkingHintIndex.value++
      }, 2200)
    } else if (thinkingTimer) {
      clearInterval(thinkingTimer)
      thinkingTimer = null
    }
  },
)

onBeforeUnmount(() => {
  if (thinkingTimer) clearInterval(thinkingTimer)
})

// The empty streaming bubble — loading, last message, no tool lines or text yet.
function isThinkingBubble(msg: ChatMessage): boolean {
  return (
    props.loading &&
    msg.role === "assistant" &&
    !msg.content &&
    !msg.toolCallSummary?.length &&
    props.messages[props.messages.length - 1]?.id === msg.id
  )
}

// The tool line that shimmers: the last summary line of the message that is
// still streaming, and only until its text reply begins. Once `loading` flips
// off (or `content` arrives) the line settles to the static gray style.
function isActiveToolLine(msg: ChatMessage, i: number): boolean {
  if (!props.loading || msg.content) return false
  if (props.messages[props.messages.length - 1]?.id !== msg.id) return false
  return i === (msg.toolCallSummary?.length ?? 0) - 1
}

// ── Quick chips ─────────────────────────────────────────────────────

const quickActions = computed(() =>
  props.hasActivities
    ? [
        { label: "Fill the gaps", icon: "lucide:sparkles", emit: "fillGaps" as const },
        { label: "Optimize route", icon: "lucide:route", emit: "optimizeRoute" as const },
        { label: "Generate full day", icon: "lucide:wand-2", emit: "generateFull" as const },
      ]
    : [{ label: "Generate full day", icon: "lucide:wand-2", emit: "generateFull" as const }],
)

function fireQuickAction(name: "fillGaps" | "optimizeRoute" | "generateFull") {
  if (name === "fillGaps") emit("fillGaps")
  else if (name === "optimizeRoute") emit("optimizeRoute")
  else if (name === "generateFull") emit("generateFull")
}

// ── Proposal state helpers (pulled from parent via message.proposalStates) ──

function proposalState(
  message: ChatMessage,
  id: string,
): "pending" | "applying" | "applied" | "dismissed" {
  return message.proposalStates?.[id] ?? "pending"
}

/** Has a later edit to this proposal's day overtaken it? */
function isSuperseded(message: ChatMessage, id: string): boolean {
  return message.proposalSuperseded?.[id] === true
}

/** A pending card is only actionable while nothing has landed after it. */
function isActionable(message: ChatMessage, id: string): boolean {
  return proposalState(message, id) === "pending" && !isSuperseded(message, id)
}

/**
 * Undo needs BOTH: a snapshot in this session, and a day nobody has touched
 * since. Either missing and the button is replaced by the reason, because a
 * button that silently does nothing (no snapshot) or quietly discards a
 * co-traveller's edits (superseded) is worse than no button.
 */
function canUndo(message: ChatMessage, id: string): boolean {
  return message.proposalUndoable?.[id] === true && !isSuperseded(message, id)
}

function undoNote(message: ChatMessage, p: Proposal): string {
  return isSuperseded(message, p.id)
    ? `${dayBadge(p)} has changed since — undoing would discard those edits.`
    : "Undo is only available until you leave the page."
}

function onApply(message: ChatMessage, proposal: Proposal) {
  emit("applyProposal", message.id, proposal)
}

function onDismiss(message: ChatMessage, proposal: Proposal) {
  emit("dismissProposal", message.id, proposal.id)
}

// ── Proposal grouping (proposals from one chat turn sharing a groupId) ──

interface ProposalGroup {
  key: string
  proposals: Proposal[]
  dayIds: string[]
}

function proposalGroups(msg: ChatMessage): ProposalGroup[] {
  const out: ProposalGroup[] = []
  const byGroup = new Map<string, Proposal[]>()
  for (const p of msg.proposals ?? []) {
    const key = p.groupId ?? `single:${p.id}`
    const arr = byGroup.get(key) ?? []
    arr.push(p)
    byGroup.set(key, arr)
  }
  for (const [key, proposals] of byGroup) {
    out.push({ key, proposals, dayIds: [...new Set(proposals.map((p) => p.dayId))] })
  }
  return out
}

function dayBadge(p: Proposal): string {
  return props.dayLabels[p.dayId] ?? "This day"
}

/** Drives the group header — hidden once there is nothing left to act on. */
function groupPending(msg: ChatMessage, g: ProposalGroup): boolean {
  return g.proposals.some((p) => isActionable(msg, p.id))
}

function onApplyGroup(message: ChatMessage, g: ProposalGroup) {
  // Only the cards that are still actionable: "Apply all" must not quietly
  // re-run a superseded suggestion the user can no longer apply individually.
  emit(
    "applyGroup",
    message.id,
    g.proposals.filter((p) => isActionable(message, p.id)),
  )
}
function onDismissGroup(message: ChatMessage, g: ProposalGroup) {
  emit(
    "dismissGroup",
    message.id,
    g.proposals.map((p) => p.id),
  )
}

// ── Proposal kind metadata (mirror the earlier dock design) ─────────

const proposalKindMeta: Record<
  Proposal["kind"],
  { label: string; icon: string; tone: "terra" | "ocean" | "forest" | "sand" | "danger" }
> = {
  "add-activities": { label: "Addition", icon: "lucide:plus", tone: "terra" },
  "remove-activities": { label: "Removal", icon: "lucide:minus", tone: "danger" },
  reschedule: { label: "Reschedule", icon: "lucide:rotate-cw", tone: "ocean" },
  "optimize-route": { label: "Route", icon: "lucide:arrow-up-right", tone: "ocean" },
  "reorder-activities": { label: "Reorder", icon: "lucide:arrow-down-up", tone: "ocean" },
  "set-accommodation": { label: "Accommodation", icon: "lucide:sparkles", tone: "forest" },
}
</script>

<template>
  <!-- No mobile backdrop: the expanded dock is a full-screen layer, so there is
       no page left showing around it to dim, and no "outside" to tap. The X in
       the header is the close affordance. -->

  <!-- Collapsed FAB (original style) -->
  <Transition name="fab-pop">
    <button
      v-if="!expanded"
      type="button"
      class="pointer-events-auto fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] right-4 z-[70] flex h-12 w-12 items-center justify-center rounded-full bg-cta text-white shadow-lg transition-colors hover:bg-cta-hover sm:bottom-6 sm:right-6"
      title="Discuss with AI"
      @click="expand"
    >
      <Icon name="lucide:sparkles" class="h-5 w-5" />
    </button>
  </Transition>

  <!-- Expanded chat: a full-screen layer on mobile (see the stylesheet), a
       right-anchored side panel from md up. -->
  <Transition name="sheet-up">
    <div
      v-if="expanded"
      ref="dialogRef"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="dialogHeadingId"
      tabindex="-1"
      class="dock-sheet pointer-events-auto z-[70] flex flex-col focus:outline-none md:fixed md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-[calc(100dvh-2rem)] md:w-[400px] md:rounded-3xl"
      :style="layerStyle"
    >
      <!-- No drag handle below md any more. A handle promises a draggable sheet
           edge; a full-screen layer has none, and the rounded top corners it sat
           under would only frame a strip of nothing. -->
      <header
        class="mx-auto mt-3 flex w-full max-w-[28rem] shrink-0 items-center justify-between gap-2 px-4"
      >
        <div class="flex min-w-0 items-center gap-2">
          <Icon name="lucide:sparkles" class="h-4 w-4 shrink-0 text-terra-500" />
          <span
            :id="dialogHeadingId"
            class="truncate text-[10px] uppercase tracking-[0.22em] text-sand-600"
          >
            From your planner
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <span
            v-if="usageUsed != null && usageLimit != null"
            class="mr-1 text-[10px] uppercase tracking-[0.18em] tabular-nums"
            :class="(usageRemaining ?? 1) <= 10 ? 'font-medium text-terra-500' : 'text-sand-600'"
            :title="`${usageUsed}/${usageLimit} AI prompts used this month`"
          >
            {{ usageUsed }} / {{ usageLimit }}
          </span>
          <button
            v-if="messages.length > 0"
            type="button"
            class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
            title="Clear conversation"
            aria-label="Clear conversation"
            @click="emit('clear')"
          >
            <Icon name="lucide:trash-2" class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
            title="Close (keep conversation)"
            aria-label="Close"
            @click="collapse"
          >
            <Icon name="lucide:x" class="h-4 w-4" />
          </button>
        </div>
      </header>
      <div class="mx-auto mt-2 h-px w-full max-w-[28rem] shrink-0 bg-sand-300/60" />

      <!-- Message list. `min-h-0` is what lets a `flex-1` item actually scroll
           instead of growing past the layer's height. -->
      <div
        ref="listEl"
        role="log"
        aria-live="polite"
        class="dock-list relative mx-auto w-full max-w-[28rem] min-h-0 flex-1 overflow-y-auto px-4 py-3"
        @scroll="onListScroll"
      >
        <!-- Empty state -->
        <div v-if="messages.length === 0" class="flex flex-col gap-3">
          <p class="font-display text-[18px] italic leading-snug text-sand-900">
            Tell me what to change, or pick a suggestion below.
          </p>
          <p class="text-[12px] text-sand-600">
            Each reply uses 1 of your {{ usageLimit ?? 100 }} monthly credits.
          </p>

          <div v-if="starters.length > 0" class="mt-2 flex flex-col gap-2">
            <span class="text-[10px] uppercase tracking-[0.22em] text-sand-600">Or try</span>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="s in starters"
                :key="s"
                type="button"
                class="dock-chip"
                @mousedown.prevent
                @click="selectStarter(s)"
              >
                {{ s }}
              </button>
            </div>
          </div>
        </div>

        <!-- Messages -->
        <ul v-else class="flex list-none flex-col gap-4 p-0">
          <li v-for="msg in messages" :key="msg.id">
            <!-- User message -->
            <div v-if="msg.role === 'user'" class="flex justify-end">
              <div class="dock-user-bubble">{{ msg.content }}</div>
            </div>

            <!-- System message -->
            <div v-else-if="msg.role === 'system'" class="flex justify-center">
              <span class="dock-system-line">{{ msg.content }}</span>
            </div>

            <!-- Assistant message -->
            <div v-else class="flex flex-col gap-2">
              <div v-if="msg.toolCallSummary?.length" class="flex flex-col gap-0.5">
                <p v-for="(line, i) in msg.toolCallSummary" :key="i" class="dock-tool-line">
                  <Icon name="lucide:eye" class="dock-tool-icon" />
                  <span
                    :class="[
                      'dock-tool-text',
                      { 'dock-tool-text--active': isActiveToolLine(msg, i) },
                    ]"
                  >
                    {{ line }}
                  </span>
                </p>
              </div>
              <details v-if="msg.thinkingText" class="rounded-lg bg-white/60 px-2 py-1 text-xs">
                <summary class="flex cursor-pointer items-center gap-1 opacity-70">
                  <Icon name="lucide:brain" class="dock-tool-icon" />
                  <span>Thinking</span>
                </summary>
                <p class="mt-1 whitespace-pre-wrap opacity-60">{{ msg.thinkingText }}</p>
              </details>
              <div
                v-if="isThinkingBubble(msg)"
                class="dock-thinking"
                role="status"
                aria-live="polite"
              >
                <span class="dock-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
                <span class="dock-thinking-text">{{ thinkingText }}</span>
              </div>
              <div
                v-else
                class="dock-assistant-body"
                v-html="renderMarkdown(msg.id, msg.content)"
              />

              <!-- Inline proposal cards, grouped by chat-turn groupId -->
              <div v-for="g in proposalGroups(msg)" :key="g.key" class="mt-1 flex flex-col gap-2">
                <div
                  v-if="g.proposals.length > 1 && groupPending(msg, g)"
                  class="flex items-center justify-between px-1"
                >
                  <span class="text-[10px] uppercase tracking-[0.22em] text-sand-600">
                    Applies to {{ g.dayIds.length }} day{{ g.dayIds.length === 1 ? "" : "s" }}
                  </span>
                  <div class="flex items-center gap-2">
                    <button type="button" class="dock-dismiss" @click="onDismissGroup(msg, g)">
                      Dismiss all
                    </button>
                    <button type="button" class="dock-apply" @click="onApplyGroup(msg, g)">
                      <Icon name="lucide:sparkles" class="h-3.5 w-3.5" />
                      <span>Apply all</span>
                    </button>
                  </div>
                </div>

                <ul class="flex list-none flex-col gap-2 p-0">
                  <li
                    v-for="p in g.proposals"
                    v-show="proposalState(msg, p.id) !== 'dismissed'"
                    :key="p.id"
                    class="dock-proposal"
                  >
                    <template v-if="proposalState(msg, p.id) === 'applied'">
                      <span class="dock-applied-stamp">Applied</span>
                      <button
                        v-if="canUndo(msg, p.id)"
                        type="button"
                        class="dock-undo"
                        @click="emit('undo', p.dayId)"
                      >
                        Undo
                      </button>
                      <p v-else class="dock-note">{{ undoNote(msg, p) }}</p>
                    </template>
                    <template v-else>
                      <div
                        class="flex items-center justify-between gap-2 border-b border-dashed border-sand-300/60 px-3 py-1.5"
                        :class="p.kind === 'remove-activities' ? 'dock-proposal-danger' : ''"
                      >
                        <div class="flex items-center gap-2">
                          <span class="dock-stamp" :data-tone="proposalKindMeta[p.kind].tone">
                            <Icon :name="proposalKindMeta[p.kind].icon" class="h-3 w-3" />
                          </span>
                          <span class="text-[10px] uppercase tracking-[0.22em] text-sand-700">
                            {{ proposalKindMeta[p.kind].label }}
                          </span>
                        </div>
                        <span class="dock-day-badge">{{ dayBadge(p) }}</span>
                      </div>
                      <div class="px-3 pb-2.5 pt-2">
                        <h4 class="font-display text-[16px] leading-snug text-sand-900">
                          {{ p.summary }}
                        </h4>
                        <!-- Never applied, and no longer safe to apply. Shown
                             rather than hidden: the user should be able to see
                             what was suggested and why it lapsed. -->
                        <p
                          v-if="isSuperseded(msg, p.id)"
                          class="mt-1.5 text-[12px] leading-snug text-sand-600"
                        >
                          Not applied. {{ dayBadge(p) }} has changed since this was suggested — ask
                          again for an up-to-date version.
                        </p>
                        <div class="mt-2 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            class="dock-dismiss"
                            :disabled="proposalState(msg, p.id) === 'applying'"
                            @click="onDismiss(msg, p)"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            :disabled="
                              proposalState(msg, p.id) === 'applying' || isSuperseded(msg, p.id)
                            "
                            :title="
                              isSuperseded(msg, p.id)
                                ? `${dayBadge(p)} has changed since this was suggested`
                                : undefined
                            "
                            class="dock-apply"
                            :class="{
                              'dock-apply-danger': p.kind === 'remove-activities',
                              'dock-apply-stale': isSuperseded(msg, p.id),
                            }"
                            @click="onApply(msg, p)"
                          >
                            <Icon name="lucide:sparkles" class="h-3.5 w-3.5" />
                            <span>{{
                              proposalState(msg, p.id) === "applying" ? "Applying" : "Apply"
                            }}</span>
                          </button>
                        </div>
                      </div>
                    </template>
                  </li>
                </ul>
              </div>
            </div>
          </li>
        </ul>

        <Transition
          enter-active-class="duration-150 ease-out"
          enter-from-class="opacity-0 translate-y-1"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="duration-100 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <button
            v-if="newReplyPending"
            type="button"
            class="dock-new-reply"
            @click="scrollToBottom()"
          >
            <Icon name="lucide:arrow-down" class="h-3.5 w-3.5" />
            new reply
          </button>
        </Transition>
      </div>

      <!-- Quick action chips -->
      <div class="mx-auto w-full max-w-[28rem] shrink-0 px-4 pb-2">
        <!-- Wider than the sheet at 320-390px, so the last chip is cut off. Fade
             the trailing edge so that reads as "swipe for more", not as clipping. -->
        <div class="dock-chip-row flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          <button
            v-for="qa in quickActions"
            :key="qa.label"
            type="button"
            :disabled="loading"
            class="dock-chip dock-chip-quick"
            @click="fireQuickAction(qa.emit)"
          >
            <Icon :name="qa.icon" class="h-3.5 w-3.5 text-terra-500" />
            {{ qa.label }}
          </button>
        </div>
      </div>

      <!-- Composer: the LAST element of the flex column, in normal flow. Not
           pinned, not lifted — the browser scrolls it into view above the
           keyboard by itself, which is the entire point of the redesign. -->
      <div class="dock-input-area mx-auto w-full max-w-[28rem] shrink-0 px-4">
        <BorderBeam
          size="sm"
          color-variant="sunset"
          theme="dark"
          :brightness="0.45"
          :strength="0.4"
          :saturation="0.9"
          :duration="4"
          class="dock-beam w-full"
        >
          <div class="flex items-end gap-2 rounded-[22px] bg-sand-900 py-2 pl-3 pr-2">
            <span
              v-if="loading"
              class="flex h-11 shrink-0 items-center gap-[3px] pl-1"
              aria-hidden="true"
            >
              <span class="dock-dot block h-1.5 w-1.5 rounded-full bg-terra-400" />
              <span class="dock-dot block h-1.5 w-1.5 rounded-full bg-terra-400" />
              <span class="dock-dot block h-1.5 w-1.5 rounded-full bg-terra-400" />
            </span>
            <Icon
              v-else
              name="lucide:sparkles"
              class="mb-3.5 h-4 w-4 shrink-0 text-terra-400"
              aria-hidden="true"
            />
            <textarea
              ref="inputEl"
              :value="input"
              rows="1"
              :disabled="loading || limitReached"
              :placeholder="placeholder"
              aria-label="Message the planner"
              enterkeyhint="send"
              class="dock-composer min-w-0 flex-1 resize-none border-none bg-transparent text-sand-50 placeholder:italic placeholder:text-sand-50/70 focus:outline-none disabled:opacity-70"
              @input="onComposerInput"
              @focus="onComposerFocus"
              @blur="onComposerBlur"
              @keydown.enter.exact.prevent="handleSubmit"
            />
            <button
              v-if="thinkingAvailable"
              type="button"
              class="flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs transition"
              :class="thinking ? 'bg-cta text-white opacity-100' : 'opacity-60'"
              :aria-pressed="thinking"
              :title="
                thinking
                  ? // 3x the base cost, up to a ceiling of 15 credits (creditsForSteps(MAX_DISCUSS_STEPS_THINKING, MAX_DISCUSS_STEPS_THINKING) * THINKING_CREDIT_MULTIPLIER
                    // in server/utils/ai-credit-cost.ts) — a discuss turn is step-metered, not flat-rate, so
                    // stating a single number here would misstate the price on a research-heavy turn.
                    'Thinking mode on — deeper reasoning, 3× cost. A research-heavy turn can cost up to 15 credits.'
                  : 'Thinking mode off'
              "
              @click="emit('update:thinking', !thinking)"
            >
              <Icon name="lucide:brain" class="dock-tool-icon" />
              <span>{{ thinking ? "3×" : "Think" }}</span>
            </button>
            <button
              type="button"
              :disabled="!loading && (!input.trim() || limitReached)"
              class="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-40"
              :class="loading ? 'bg-sand-600 hover:bg-sand-500' : 'bg-terra-500 hover:bg-terra-600'"
              :title="loading ? 'Cancel' : 'Send'"
              :aria-label="loading ? 'Cancel' : 'Send'"
              @click="handleSendClick"
            >
              <Icon :name="loading ? 'lucide:x' : 'lucide:arrow-up'" class="h-4 w-4" />
            </button>
          </div>
        </BorderBeam>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dock-sheet {
  background: var(--color-sand-50);
  box-shadow:
    0 0 0 1px rgba(61, 51, 40, 0.08),
    0 -24px 56px -20px rgba(61, 51, 40, 0.3);
}

@media (min-width: 768px) {
  .dock-sheet {
    box-shadow:
      0 0 0 1px rgba(61, 51, 40, 0.08),
      0 24px 48px -16px rgba(61, 51, 40, 0.22),
      0 -8px 32px -16px rgba(61, 51, 40, 0.1);
  }
}
.dock-sheet::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
  z-index: 0;
}
.dock-sheet > * {
  position: relative;
  z-index: 1;
}

.dock-sheet {
  /* Kill the 300ms tap delay across the sheet's controls. */
  touch-action: manipulation;
}

/* ── The mobile layer: full-screen, in normal document flow ─────────
   NOT `position: fixed`, and never again. iOS Safari stops honouring fixed
   positioning while the virtual keyboard is up — fixed elements degrade toward
   `static` — so three shipped attempts at a fixed bottom sheet (#75's
   transform, #76's `bottom`, #77's visual-viewport `top` + `translateY(-100%)`)
   were all adjusting a property on an element whose positioning model Safari
   had already abandoned. #77 measured 0.00px of error in headless Chrome and
   was still visibly wrong on the device.

   And even a perfectly anchored sheet could not have worked: iOS's floating
   accessory bar (the ^ / v / Done pill) is NOT included in
   `visualViewport.height`, so a sheet whose bottom edge lands exactly on the
   visual viewport's bottom edge still stops above the pill and leaves a strip
   of page showing. The target is unreachable through that API.

   So the fight is removed rather than re-fought. `position: absolute` +
   `height: 100dvh` anchored to a DOCUMENT coordinate (`--dock-anchor-top`, the
   scroll offset the dock opened at — see `utils/dock-anchor.ts`). Nothing is
   pinned to a viewport edge, so there is nothing for iOS to mis-place, and the
   browser's own "scroll the focused input into view" scrolls the whole layer
   the way it would on any ordinary page — accessory bar accounted for, because
   the browser is the one doing the accounting.

   Everything mobile lives inside this media query, so the >=768px side panel
   (positioned entirely by `md:` utility classes) is untouched by construction
   rather than by a runtime guard. */
@media (max-width: 767px) {
  .dock-sheet {
    position: absolute;
    top: var(--dock-anchor-top, 0px);
    left: 0;
    right: 0;
    /* The VISIBLE strip, not the screen. `--dock-viewport-height` is
       `visualViewport.offsetTop + visualViewport.height`, published by the
       component while the layer is open (see `syncViewportHeight`); with the
       keyboard down that equals `100dvh`, and with it up the layer's bottom
       edge is the keyboard's top edge, so the composer — the last child of the
       flex column — lands on the keyboard by plain block layout.

       This is a HEIGHT on an in-flow box, not the position of a fixed one:
       iOS's fixed-position degradation (the thing that broke #75/#76/#77) has
       no purchase on it. The fallback keeps the pre-JS/SSR paint full-screen. */
    height: var(--dock-viewport-height, 100dvh);
    /* A full-screen layer has no top edge on show, so rounding it would only
       frame a sliver of nothing. Square, and pad past the notch instead. */
    border-radius: 0;
    padding-top: env(safe-area-inset-top, 0px);
    /* Bleed the layer's own background one viewport further down, as a shadow
       so it costs no layout and no scroll range.

       The overshoot it was originally added to hide is gone — the document is
       now exactly one viewport tall while the layer is open (see the global
       block below), so there is no page left underneath to be scrolled into
       view. One case does survive that: iOS rubber-band overscroll. Elastic
       bounce at the bottom edge happens even on a document that cannot
       actually scroll, and it lifts the layer off the bottom of the screen for
       the length of the gesture. Without the bleed that exposes the html
       background under the composer. `box-shadow` never contributes scrollable
       overflow, so keeping it cannot reintroduce the room this fix removes. */
    box-shadow:
      0 -24px 56px -20px rgba(61, 51, 40, 0.3),
      0 100dvh 0 0 var(--color-sand-50);
  }
}

.dock-list {
  scrollbar-width: thin;
  scrollbar-color: var(--color-sand-300) transparent;
  /* Stop scroll chaining: reaching the top/bottom of the transcript must not
     start scrolling (or rubber-banding) the page behind the sheet. */
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.dock-list::-webkit-scrollbar {
  width: 4px;
}
.dock-list::-webkit-scrollbar-track {
  background: transparent;
}
.dock-list::-webkit-scrollbar-thumb {
  background: var(--color-sand-300);
  border-radius: 9999px;
}

.dock-user-bubble {
  background: var(--color-sand-100);
  color: var(--color-sand-900);
  border: 1px solid var(--color-sand-200);
  border-radius: 18px;
  padding: 8px 14px;
  max-width: 80%;
  font-size: 14px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.dock-assistant-body {
  font-size: 15px;
  /* ~1.6 leading + a comfortable (not maximal) text colour: sand-900 is
     near-white in dark mode (~16:1, harsh for long reading); sand-700 lands
     around the ~87% "high-emphasis" level (~11:1) and stays readable in light
     mode. Bold keeps sand-900 so emphasis still pops against the softer body. */
  line-height: 1.6;
  color: var(--color-sand-700);
}

.dock-assistant-body :where(p) {
  margin: 0 0 14px;
}
.dock-assistant-body :where(p:last-child) {
  margin-bottom: 0;
}
.dock-assistant-body :where(strong) {
  font-weight: 600;
  color: var(--color-sand-900);
}
.dock-assistant-body :where(em) {
  font-style: italic;
}
.dock-assistant-body :where(del) {
  text-decoration: line-through;
  opacity: 0.7;
}
.dock-assistant-body :where(a) {
  color: var(--color-terra-600, var(--color-sand-900));
  text-decoration: underline;
  text-underline-offset: 2px;
}
.dock-assistant-body :where(ul, ol) {
  margin: 4px 0 8px;
  padding-left: 20px;
}
.dock-assistant-body :where(li) {
  margin: 2px 0;
}
.dock-assistant-body :where(li > p) {
  margin: 0;
}
.dock-assistant-body :where(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
  background: var(--color-sand-100);
  border: 1px solid var(--color-sand-200);
  border-radius: 4px;
  padding: 0 4px;
}
.dock-assistant-body :where(pre) {
  margin: 6px 0 8px;
  padding: 8px 10px;
  background: var(--color-sand-100);
  border: 1px solid var(--color-sand-200);
  border-radius: 8px;
  overflow-x: auto;
}
.dock-assistant-body :where(pre code) {
  background: transparent;
  border: 0;
  padding: 0;
}
.dock-assistant-body :where(blockquote) {
  margin: 6px 0 8px;
  padding: 2px 10px;
  border-left: 3px solid var(--color-sand-300);
  color: var(--color-sand-700);
}
.dock-assistant-body :where(h1, h2, h3, h4, h5, h6) {
  margin: 8px 0 4px;
  font-weight: 600;
  line-height: 1.3;
}
.dock-assistant-body :where(h1) {
  font-size: 1.15em;
}
.dock-assistant-body :where(h2) {
  font-size: 1.08em;
}
.dock-assistant-body :where(h3, h4, h5, h6) {
  font-size: 1em;
}
.dock-assistant-body :where(hr) {
  margin: 8px 0;
  border: 0;
  border-top: 1px solid var(--color-sand-200);
}

.dock-system-line {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--color-sand-500);
}

.dock-thinking {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-style: italic;
  color: var(--color-sand-500);
}
.dock-thinking-dots {
  display: inline-flex;
  gap: 3px;
}
.dock-thinking-dots i {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: currentColor;
  opacity: 0.35;
  animation: dock-thinking-pulse 1.2s ease-in-out infinite;
}
.dock-thinking-dots i:nth-child(2) {
  animation-delay: 0.18s;
}
.dock-thinking-dots i:nth-child(3) {
  animation-delay: 0.36s;
}
.dock-thinking-text {
  animation: dock-thinking-fade 2.2s ease-in-out infinite;
}
@keyframes dock-thinking-pulse {
  0%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
@keyframes dock-thinking-fade {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dock-thinking-dots i,
  .dock-thinking-text {
    animation: none;
  }
  .dock-thinking-dots i {
    opacity: 0.6;
  }
}

.dock-tool-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-sand-500);
  font-style: italic;
  animation: dock-tool-in 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}
.dock-tool-icon {
  width: 12px;
  height: 12px;
  color: var(--color-sand-500);
  flex-shrink: 0;
}
@keyframes dock-tool-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Shimmer sweeps a brighter (sand-800) band through the muted sand-500 text.
   The sand var swap keeps sand-800 as the most prominent text tone in BOTH
   themes, so this reads correctly in light and dark without a media query. */
.dock-tool-text--active {
  color: transparent;
  -webkit-text-fill-color: transparent;
  background-image: linear-gradient(
    100deg,
    var(--color-sand-500) 0%,
    var(--color-sand-500) 40%,
    var(--color-sand-800) 50%,
    var(--color-sand-500) 60%,
    var(--color-sand-500) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation: dock-tool-shimmer 1.4s linear infinite;
}
@keyframes dock-tool-shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}

.dock-proposal {
  border: 1px solid var(--color-sand-300);
  background: var(--color-sand-50);
  border-radius: 14px;
  overflow: hidden;
  box-shadow:
    0 1px 0 0 rgba(61, 51, 40, 0.04),
    0 6px 18px -10px rgba(61, 51, 40, 0.18);
}

.dock-stamp {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  width: 18px;
  border-radius: 4px;
  font-family: var(--font-display);
  font-style: italic;
  font-size: 13px;
  background: var(--color-sand-100);
  border: 1px solid var(--color-sand-300);
  color: var(--color-sand-800);
  transform: rotate(-3deg);
}
.dock-stamp[data-tone="terra"] {
  background: var(--color-terra-50);
  border-color: var(--color-terra-200);
  color: var(--color-terra-700);
}
.dock-stamp[data-tone="ocean"] {
  background: var(--color-ocean-50);
  border-color: var(--color-ocean-200);
  color: var(--color-ocean-700);
}
.dock-stamp[data-tone="forest"] {
  background: var(--color-forest-50);
  border-color: var(--color-forest-200);
  color: var(--color-forest-700);
}
.dock-stamp[data-tone="danger"] {
  background: var(--color-red-50);
  border-color: var(--color-red-200);
  color: var(--color-red-700);
}

.dock-proposal-danger {
  background: var(--color-red-50);
  border-color: var(--color-red-200);
}

.dock-day-badge {
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--color-sand-600);
  background: var(--color-sand-100);
  border: 1px solid var(--color-sand-200);
  border-radius: 9999px;
  padding: 1px 8px;
}

.dock-undo {
  margin: 0 12px 8px;
  font-size: 13px;
  color: var(--color-terra-600);
  min-height: 32px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.dock-apply {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 500;
  color: white;
  background: linear-gradient(180deg, var(--color-terra-500) 0%, var(--color-terra-600) 100%);
  touch-action: manipulation;
}
.dock-apply:disabled {
  opacity: 0.6;
  cursor: progress;
}
.dock-apply-danger {
  background: linear-gradient(180deg, #ef4444 0%, #dc2626 100%);
}
/* Disabled because it lapsed, not because it is working — `cursor: progress`
   would promise it is about to happen. */
.dock-apply-stale:disabled {
  cursor: not-allowed;
  background: var(--color-sand-300);
  color: var(--color-sand-700);
}

/* The explanation that replaces an Undo button, or sits under a lapsed card. */
.dock-note {
  margin: 0 12px 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-sand-600);
}
.dock-dismiss {
  font-size: 13px;
  color: var(--color-sand-600);
  min-height: 44px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  touch-action: manipulation;
}

.dock-applied-stamp {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  margin: 8px 12px;
  border: 1.5px solid var(--color-forest-500);
  border-radius: 6px;
  color: var(--color-forest-700);
  font-family: var(--font-display);
  font-style: italic;
  font-size: 14px;
  letter-spacing: 0.04em;
  background: var(--color-forest-50);
  transform: rotate(-4deg);
}

.dock-chip-row {
  container-type: scroll-state;
}
@container scroll-state(scrollable: right) {
  .dock-chip-row {
    mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent 100%);
  }
}

.dock-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px 9px;
  min-height: 44px;
  font-size: 13px;
  color: var(--color-sand-800);
  background: var(--color-sand-100);
  border: 1px solid var(--color-sand-300);
  border-bottom-width: 2px;
  border-radius: 999px;
  white-space: nowrap;
  touch-action: manipulation;
  font-family: var(--font-sans);
}
.dock-chip-quick {
  background: var(--color-terra-50);
  border-color: var(--color-terra-200);
  color: var(--color-terra-700);
}
.dock-chip-quick:hover {
  background: var(--color-terra-100);
  border-color: var(--color-terra-300);
  color: var(--color-terra-800);
}
.dock-chip-quick :deep(.iconify) {
  color: var(--color-terra-600) !important;
}

.dock-new-reply {
  position: sticky;
  bottom: 8px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  padding: 6px 14px;
  border-radius: 9999px;
  background: var(--color-sand-900);
  color: var(--color-sand-50);
  font-size: 12px;
  box-shadow: 0 6px 18px -6px rgba(61, 51, 40, 0.4);
}

.dock-dot {
  animation: dotPulse 1.4s ease-in-out infinite;
}
.dock-dot:nth-child(2) {
  animation-delay: 0.16s;
}
.dock-dot:nth-child(3) {
  animation-delay: 0.32s;
}
@keyframes dotPulse {
  0%,
  60%,
  100% {
    transform: scale(0.7);
    opacity: 0.55;
  }
  30% {
    transform: scale(1);
    opacity: 1;
  }
}

.dock-beam {
  border-radius: 22px;
}

/* The composer sits on the screen's bottom edge whenever the keyboard is down,
   so it owns the home-indicator inset. (With the keyboard up iOS reports the
   inset as 0 and the `0.5rem` floor is all that is left, which is what we
   want — every pixel counts there.) */
.dock-input-area {
  padding-bottom: max(env(safe-area-inset-bottom, 0px), 0.5rem);
}

/* 16px exactly. Anything smaller makes iOS Safari zoom the page on focus, and
   the viewport meta no longer suppresses that (pinch-zoom is back on, by
   design). The composer grows via JS up to a cap, then scrolls internally. */
.dock-composer {
  font-size: 16px;
  line-height: 1.4;
  max-height: 120px;
  padding: 11px 0;
  overflow-y: auto;
  scrollbar-width: thin;
  overscroll-behavior: contain;
}

.fab-pop-enter-active,
.fab-pop-leave-active {
  transition:
    opacity 0.18s ease-out,
    transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: bottom right;
}
.fab-pop-enter-from,
.fab-pop-leave-to {
  opacity: 0;
  transform: scale(0.7);
}
.fab-pop-enter-to,
.fab-pop-leave-from {
  opacity: 1;
  transform: scale(1);
}

.sheet-up-enter-active {
  transition:
    transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.22s ease-out;
}
.sheet-up-leave-active {
  transition:
    transform 0.22s ease-in,
    opacity 0.15s ease-in;
}
.sheet-up-enter-from,
.sheet-up-leave-to {
  opacity: 0;
  transform: translateY(100%);
}
.sheet-up-enter-to,
.sheet-up-leave-from {
  opacity: 1;
  transform: translateY(0);
}

@media (min-width: 768px) {
  .sheet-up-enter-from,
  .sheet-up-leave-to {
    transform: translateX(110%);
  }
  .sheet-up-enter-to,
  .sheet-up-leave-from {
    transform: translateX(0);
  }
}

/* Nothing else owns `transform` on `.dock-sheet` any more. The lifting
   transform, and the endpoint arithmetic that had to compose with it (attempts
   2 and 3 both broke on exactly this collision), are gone with the lift — so
   the entrance above is the plain slide-up it was originally, with no
   specificity juggling holding it together. */

@media (prefers-reduced-motion: reduce) {
  .fab-pop-enter-active,
  .fab-pop-leave-active,
  .sheet-up-enter-active,
  .sheet-up-leave-active {
    transition: opacity 0.15s ease-out;
  }
  .fab-pop-enter-from,
  .fab-pop-leave-to,
  .sheet-up-enter-from,
  .sheet-up-leave-to {
    transform: none;
  }
  .dock-dot {
    animation: none;
  }
  .dock-tool-line {
    animation: none;
  }
  .dock-tool-text--active {
    animation: none;
    color: var(--color-sand-700);
    -webkit-text-fill-color: var(--color-sand-700);
    background: none;
  }
}
</style>

<!-- Deliberately NOT scoped: the element this collapses belongs to the page
     that hosts the dock, not to the dock. -->
<style>
/* ── The document-height cap ────────────────────────────────────────
   #78 made the mobile dock a full-screen layer in normal flow and removed the
   mobile scroll lock, which is what finally let iOS scroll the focused
   composer into view. It then overshot: on iOS 26 the composer came to rest
   about 190px ABOVE the keyboard's accessory bar, with a band of empty layer
   between them.

   That is what "scroll the input into view" does when there is far more
   document to scroll than one keyboard's worth. The layer is `position:
   absolute` over a document that still contained the entire trip page —
   thousands of pixels of scroll range — and nothing constrained how far the
   browser could travel through it.

   So constrain it structurally: while the layer is open, the trip page comes
   out of layout and the document is exactly one viewport tall. The only
   movement iOS can then perform is the keyboard's own offset, and the composer
   lands flush on the keyboard. Anything that puts scrollable room back
   underneath the layer brings the overshoot back with it.

   `height: 0; overflow: hidden` rather than `display: none`, for two reasons:
     - the clipped subtree keeps its own layout, so the Google map inside it
       never sees a 0x0 container and never has to re-render when the dock
       closes (`display: none` would collapse it and every other measured box);
     - it is one declaration pair on one wrapper, so nothing about the page's
       structure has to change to accommodate it.
   Either way the components stay MOUNTED — this is not `v-if`, so no state,
   no in-flight request and no scroll position inside the page is destroyed.

   >=768px is untouched by construction: the side panel does not cover the page
   and is meant to coexist with a scrollable one. */
@media (max-width: 767px) {
  html.dock-page-collapsed [data-dock-page-content] {
    height: 0;
    overflow: hidden;
  }
}
</style>
