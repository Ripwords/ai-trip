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
  role: ChatRole
  content: string
  toolCallSummary?: string[]
  proposals?: Proposal[]
  proposalStates?: Record<string, "pending" | "applying" | "applied" | "dismissed">
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
  activeDayLabel: string
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

const inputEl = ref<HTMLInputElement | null>(null)
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

watch(
  () => props.messages.length,
  () => {
    if (userScrolledUp.value) {
      newReplyPending.value = true
    } else {
      nextTick(() => scrollToBottom())
    }
  },
)

watch(
  () => props.loading,
  (isLoading) => {
    if (isLoading) expanded.value = true
  },
)

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

function groupPending(msg: ChatMessage, g: ProposalGroup): boolean {
  return g.proposals.some((p) => proposalState(msg, p.id) === "pending")
}

function onApplyGroup(message: ChatMessage, g: ProposalGroup) {
  emit("applyGroup", message.id, g.proposals)
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
      class="pointer-events-auto fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] right-4 z-[70] flex h-12 w-12 items-center justify-center rounded-full bg-terra-500 text-white shadow-lg transition-colors hover:bg-terra-600 sm:bottom-6 sm:right-6"
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
      class="dock-sheet pointer-events-auto fixed inset-x-0 bottom-0 z-[70] flex max-h-[70vh] min-h-[50vh] flex-col rounded-t-[28px] focus:outline-none md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-[calc(100vh-2rem)] md:min-h-0 md:w-[400px] md:rounded-3xl"
      :style="{
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)',
      }"
    >
      <div class="mx-auto mt-3 h-1 w-12 shrink-0 rounded-full bg-sand-400/40 md:hidden" />

      <header class="mx-auto mt-3 flex w-full max-w-[28rem] items-baseline justify-between px-4">
        <div class="flex items-center gap-2">
          <Icon name="lucide:sparkles" class="h-4 w-4 text-terra-500" />
          <div class="flex flex-col">
            <span
              :id="dialogHeadingId"
              class="text-[10px] uppercase tracking-[0.22em] text-sand-600"
            >
              From your planner
            </span>
            <span class="text-[10px] text-sand-500">Editing {{ activeDayLabel }}</span>
          </div>
        </div>
        <div class="flex items-baseline gap-3">
          <span
            v-if="usageUsed != null && usageLimit != null"
            class="text-[10px] uppercase tracking-[0.18em] tabular-nums"
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
          <p class="text-[11px] text-sand-600">
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
                  {{ line }}
                </p>
              </div>
              <div class="dock-assistant-body" v-html="renderMarkdown(msg.id, msg.content)" />

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
                      <button type="button" class="dock-undo" @click="emit('undo', p.dayId)">
                        Undo
                      </button>
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
                            :disabled="proposalState(msg, p.id) === 'applying'"
                            class="dock-apply"
                            :class="p.kind === 'remove-activities' ? 'dock-apply-danger' : ''"
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
        <div class="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
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
          <div class="flex items-center gap-2 rounded-full bg-sand-900 py-2 pl-3 pr-2">
            <span v-if="loading" class="flex shrink-0 items-end gap-[3px] pl-1" aria-hidden="true">
              <span class="dock-dot block h-1.5 w-1.5 rounded-full bg-terra-400" />
              <span class="dock-dot block h-1.5 w-1.5 rounded-full bg-terra-400" />
              <span class="dock-dot block h-1.5 w-1.5 rounded-full bg-terra-400" />
            </span>
            <Icon
              v-else
              name="lucide:sparkles"
              class="h-4 w-4 shrink-0 text-terra-400"
              aria-hidden="true"
            />
            <input
              ref="inputEl"
              :value="input"
              type="text"
              :disabled="loading || limitReached"
              :placeholder="placeholder"
              class="min-w-0 flex-1 border-none bg-transparent text-sm text-sand-50 placeholder:italic placeholder:text-sand-50/70 focus:outline-none disabled:opacity-70"
              @input="emit('update:input', ($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="handleSubmit"
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

.dock-list {
  scrollbar-width: thin;
  scrollbar-color: var(--color-sand-300) transparent;
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
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--color-sand-900);
}

.dock-assistant-body :where(p) {
  margin: 0 0 8px;
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

.dock-tool-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-sand-500);
  font-style: italic;
}
.dock-tool-icon {
  width: 12px;
  height: 12px;
  color: var(--color-sand-500);
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
  border-radius: 9999px;
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
}
</style>
