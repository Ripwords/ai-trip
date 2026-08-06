<script setup lang="ts">
import { BorderBeam } from "vue-border-beam"
import { marked } from "marked"
import DOMPurify from "dompurify"
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

// The sheet is a modal on mobile: without this the page behind it scrolls under
// the finger and iOS rubber-bands the whole document when the message list hits
// its end. Held on desktop too, where the dock is a side panel — the page is
// still not meant to move while a modal dialog owns focus.
useBodyScrollLock(() => expanded.value)

// ── Sheet geometry ──────────────────────────────────────────────────
// `dvh` alone is not enough. iOS Safari ignores `interactive-widget=
// resizes-content` and composites the keyboard OVER the page, so `70dvh` keeps
// measuring the full screen and the composer ends up behind the keyboard —
// invisible on a real iPhone while looking perfectly fine in headless Chrome.
// Lift the sheet by the measured keyboard inset and size it against the visual
// viewport instead. On Android the inset is ~0 and this reduces to the dvh
// behaviour it replaces.
//
// The lift is ANIMATED, not sampled. `useKeyboardInset` publishes a settled
// target rather than every `visualViewport` reading, and the sheet transitions
// to it in CSS (see the stylesheet). Restyling on every event made the sheet
// step through whatever coarse, irregular frames iOS chose to report —
// different every time, which is what "not smooth and not consistent" was.
const { inset: keyboardInset, viewportHeight } = useKeyboardInset()

// Above `md` the dock is a right-anchored side panel positioned entirely by
// utility classes (md:top-4 / md:bottom-4 / md:max-h-…). Inline styles would
// beat those, so the geometry below must apply to the bottom sheet only.
const isCompact = ref(true)
let compactQuery: MediaQueryList | null = null
function syncCompact(e: MediaQueryList | MediaQueryListEvent) {
  isCompact.value = e.matches
}
onMounted(() => {
  if (!import.meta.client) return
  compactQuery = window.matchMedia("(max-width: 767px)")
  syncCompact(compactQuery)
  compactQuery.addEventListener("change", syncCompact)
})
onBeforeUnmount(() => compactQuery?.removeEventListener("change", syncCompact))

// The lift rides on `bottom`, and must NOT go back to `transform`: iOS offsets
// a transformed `position: fixed` element by `visualViewport.offsetTop` on top
// of the translation, so the sheet overshot by that amount and left a band of
// page above the keyboard (PR #75's regression). The arithmetic, and the full
// reasoning, live in `resolveDockSheetGeometry` — a pure function so the one
// thing headless Chrome cannot check is at least unit-tested.
//
// At rest there is nothing to size: `bottom-0 max-h-[70dvh] min-h-[50dvh]` on
// the element do the work, and the only inline value is the safe-area pad.
const sheetStyle = computed<DockSheetGeometry>(() =>
  resolveDockSheetGeometry({
    isCompact: isCompact.value,
    keyboardInset: keyboardInset.value,
    viewportHeight: viewportHeight.value,
  }),
)

// Keep the newest message in view as the keyboard opens and the sheet shrinks.
// Throttled: leading so the list follows the lift straight away, trailing so it
// lands again once the transition has settled on its final height. (The scroll
// policy itself — the bottom threshold, the user-intent flag — is untouched.)
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

watch([keyboardInset, viewportHeight], followKeyboard)

onBeforeUnmount(() => {
  if (keyboardScrollTimer) clearTimeout(keyboardScrollTimer)
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
  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="expanded"
      class="fixed inset-0 z-[60] bg-sand-900/40 backdrop-blur-[2px] md:hidden"
      @click="collapse"
    />
  </Transition>

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

  <!-- Expanded chat sheet -->
  <Transition name="sheet-up">
    <div
      v-if="expanded"
      ref="dialogRef"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="dialogHeadingId"
      tabindex="-1"
      class="dock-sheet pointer-events-auto fixed inset-x-0 bottom-0 z-[70] flex max-h-[70dvh] min-h-[50dvh] flex-col rounded-t-[28px] focus:outline-none md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-[calc(100dvh-2rem)] md:min-h-0 md:w-[400px] md:rounded-3xl"
      :style="sheetStyle"
    >
      <div class="mx-auto mt-3 h-1 w-12 shrink-0 rounded-full bg-sand-400/40 md:hidden" />

      <header
        class="mx-auto mt-3 flex w-full max-w-[28rem] items-center justify-between gap-2 px-4"
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
      <div class="mx-auto mt-2 h-px w-full max-w-[28rem] bg-sand-300/60" />

      <!-- Message list -->
      <div
        ref="listEl"
        role="log"
        aria-live="polite"
        class="dock-list relative mx-auto w-full max-w-[28rem] flex-1 overflow-y-auto px-4 py-3"
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
      <div class="mx-auto w-full max-w-[28rem] px-4 pb-2">
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

      <!-- Sticky input -->
      <div class="dock-input-area mx-auto w-full max-w-[28rem] px-4 pb-2">
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
              @keydown.enter.exact.prevent="handleSubmit"
            />
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
  /* One duration/curve for every property the keyboard moves, so the sheet's
     two edges travel together. ~0.25s ease-out is iOS's own keyboard timing. */
  --dock-lift-ms: 250ms;
  --dock-lift-ease: cubic-bezier(0.17, 0.59, 0.4, 1);
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

/* ── Keyboard lift (bottom sheet only) ──────────────────────────────
   The lift is the inline `bottom` from `resolveDockSheetGeometry`, published
   once per keyboard open and once per close instead of once per visualViewport
   event, and animated HERE rather than in JS. The duration and curve
   approximate iOS's own keyboard animation (~0.25s, ease-out), so the sheet
   rides alongside the keyboard instead of chasing it a few coarse frames
   behind.

   `bottom`, NOT `transform`. iOS resolves a transformed `position: fixed`
   element differently: it additionally offsets it by `visualViewport.offsetTop`
   on top of the translation, so the sheet moved by `inset + offsetTop` and the
   surplus showed as a band of page between the sheet and the keyboard. See the
   long note in `useDockSheetGeometry.ts`. Layout-driven transitions cost the
   main thread, which is the right price for landing in the right place.

   Leaving `transform` alone also matters for a second reason: the `sheet-up`
   enter/leave classes own it for the open/close slide. Those classes declare
   their own `transition` and, being later in this stylesheet, replace the one
   below for the duration of the entrance — so the sheet slides in at its final
   geometry rather than animating two things at once.

   Above md the dock is a right-anchored side panel and none of this applies —
   `resolveDockSheetGeometry` returns nothing there, but the media query makes
   it structural rather than a matter of trusting the guard. */
@media (max-width: 767px) {
  .dock-sheet {
    transition:
      bottom var(--dock-lift-ms) var(--dock-lift-ease),
      max-height var(--dock-lift-ms) var(--dock-lift-ease),
      min-height var(--dock-lift-ms) var(--dock-lift-ease),
      padding-bottom var(--dock-lift-ms) var(--dock-lift-ease);
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

/* NOTE: the keyboard lift deliberately does not appear here. It rides on
   `bottom`, so the sheet is already in the right place before it slides, and
   `translateY(100%)` above is relative to the sheet's own height either way.
   When the lift lived on `transform` (PR #75) these classes had to carry it
   through by hand or the sheet dropped to the keyboard-less position for the
   length of its entrance — one more reason `transform` was the wrong carrier. */

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
  /* The keyboard lift itself is not decoration — the composer has to clear the
     keyboard — but it is on `bottom`, so dropping the transition below removes
     the motion while keeping the position. */
  .dock-sheet {
    transition: none;
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
