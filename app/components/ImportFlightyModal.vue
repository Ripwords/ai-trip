<script setup lang="ts">
import type { FetchError } from "ofetch"

function extractErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "data" in e) {
    const data = (e as FetchError<{ statusMessage?: string; message?: string }>).data
    // Route through humanMessage: a server that validates params with
    // `schema.parse` puts a stringified ZodError here, which must never reach
    // the user. See app/utils/human-message.ts.
    const msg = humanMessage(data?.statusMessage ?? data?.message, "")
    if (msg) return msg
  }
  if (e instanceof Error && e.message) return e.message
  return fallback
}

interface PreviewRow {
  line: number
  flightDate: string
  flightNumber: string
  departureAirport: string
  arrivalAirport: string
}

interface PreviewResponse {
  totalRows: number
  importableCount: number
  duplicateCount: number
  invalidCount: number
  preview: PreviewRow[]
  issues: { line: number; reason: string }[]
}

interface CommitResponse {
  imported: number
  skipped: number
  failed: number
  issues: { line: number; reason: string }[]
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: "close"): void
  (e: "imported"): void
}>()

type Phase = "picker" | "previewing" | "result"
const phase = ref<Phase>("picker")
const error = ref<string | null>(null)
const busy = ref(false)
const fileRef = ref<File | null>(null)
const preview = ref<PreviewResponse | null>(null)
const result = ref<CommitResponse | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function reset() {
  phase.value = "picker"
  error.value = null
  busy.value = false
  fileRef.value = null
  preview.value = null
  result.value = null
  if (fileInput.value) fileInput.value.value = ""
}

watch(
  () => props.open,
  (open) => {
    if (open) reset()
  },
)

async function onPick(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0] ?? null
  if (!file) return
  fileRef.value = file
  busy.value = true
  error.value = null
  try {
    const text = await file.text()
    preview.value = await $fetch<PreviewResponse>("/api/flights/import/preview", {
      method: "POST",
      body: text,
      headers: { "Content-Type": "text/csv" },
    })
    phase.value = "previewing"
  } catch (e: unknown) {
    error.value = extractErrorMessage(e, "Failed to read CSV")
  } finally {
    busy.value = false
  }
}

async function confirmImport() {
  if (!fileRef.value) return
  busy.value = true
  error.value = null
  try {
    const text = await fileRef.value.text()
    result.value = await $fetch<CommitResponse>("/api/flights/import", {
      method: "POST",
      body: text,
      headers: { "Content-Type": "text/csv" },
    })
    phase.value = "result"
    if (result.value.imported > 0) emit("imported")
  } catch (e: unknown) {
    error.value = extractErrorMessage(e, "Import failed")
  } finally {
    busy.value = false
  }
}

function close() {
  emit("close")
}

const panelRef = ref<HTMLElement | null>(null)

useModalA11y(panelRef, {
  isOpen: () => props.open,
  onClose: close,
})

// Freeze the page behind the modal: without this the list underneath scrolls
// under the finger and iOS rubber-bands the whole document.
useBodyScrollLock(() => props.open)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="fixed inset-0 bg-black/40" @click="close" />
      <div
        ref="panelRef"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-flighty-title"
        tabindex="-1"
        class="relative z-10 mx-4 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div class="flex items-center justify-between">
          <h2 id="import-flighty-title" class="font-display text-lg text-sand-900">
            Import from Flighty
          </h2>
          <button
            type="button"
            class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-sand-400 hover:bg-sand-100 hover:text-sand-700 focus-ring"
            aria-label="Close"
            @click="close"
          >
            <Icon name="lucide:x" class="h-5 w-5" />
          </button>
        </div>

        <div v-if="phase === 'picker'" class="mt-4 space-y-3">
          <p class="text-sm text-sand-600">
            Upload your Flighty CSV export. We'll show you a preview before importing.
          </p>
          <label
            class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-sand-300 p-6 text-center transition hover:bg-sand-50"
            :class="busy && 'pointer-events-none opacity-60'"
          >
            <Icon v-if="busy" name="lucide:loader-2" class="h-6 w-6 animate-spin text-terra-500" />
            <Icon v-else name="lucide:upload" class="h-6 w-6 text-sand-400" />
            <span class="text-sm text-sand-600">
              <template v-if="busy">Reading file and looking up airlines...</template>
              <template v-else>{{ fileRef ? fileRef.name : "Choose a .csv file" }}</template>
            </span>
            <input
              ref="fileInput"
              type="file"
              accept=".csv,text/csv"
              class="hidden"
              :disabled="busy"
              @change="onPick"
            />
          </label>
          <p v-if="error" role="alert" class="text-xs text-red-600">{{ error }}</p>
        </div>

        <div v-else-if="phase === 'previewing' && preview" class="mt-4 space-y-4">
          <div class="grid grid-cols-3 gap-3 text-center">
            <div class="rounded-xl border border-sand-200 p-3">
              <div class="font-display text-2xl text-sand-900">{{ preview.importableCount }}</div>
              <div class="text-xs text-sand-500">New</div>
            </div>
            <div class="rounded-xl border border-sand-200 p-3">
              <div class="font-display text-2xl text-sand-500">{{ preview.duplicateCount }}</div>
              <div class="text-xs text-sand-500">Duplicate</div>
            </div>
            <div class="rounded-xl border border-sand-200 p-3">
              <div class="font-display text-2xl text-sand-500">{{ preview.invalidCount }}</div>
              <div class="text-xs text-sand-500">Invalid</div>
            </div>
          </div>

          <div
            v-if="preview.preview.length > 0"
            class="max-h-60 overflow-y-auto rounded-xl border border-sand-200 scrollbar-thin"
          >
            <table class="w-full text-left text-xs">
              <thead class="bg-sand-100 text-sand-600">
                <tr>
                  <th class="px-3 py-2 font-medium">Date</th>
                  <th class="px-3 py-2 font-medium">Flight</th>
                  <th class="px-3 py-2 font-medium">Route</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in preview.preview" :key="row.line" class="border-t border-sand-100">
                  <td class="px-3 py-2 text-sand-700">{{ row.flightDate }}</td>
                  <td class="px-3 py-2 text-sand-900">{{ row.flightNumber }}</td>
                  <td class="px-3 py-2 text-sand-600">
                    {{ row.departureAirport }} → {{ row.arrivalAirport }}
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-if="preview.importableCount > preview.preview.length"
              class="px-3 py-2 text-xs text-sand-500"
            >
              + {{ preview.importableCount - preview.preview.length }} more
            </div>
          </div>

          <details
            v-if="preview.issues.length > 0"
            class="rounded-xl border border-sand-200 p-3 text-xs"
          >
            <summary class="cursor-pointer text-sand-600">
              {{ preview.issues.length }} issue(s): these rows will be skipped
            </summary>
            <ul class="mt-2 space-y-1 text-sand-600">
              <li v-for="issue in preview.issues" :key="issue.line">
                Line {{ issue.line }}: {{ issue.reason }}
              </li>
            </ul>
          </details>

          <p v-if="error" role="alert" class="text-xs text-red-600">{{ error }}</p>

          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded-xl border border-sand-200 px-4 py-2 text-sm text-sand-700 hover:bg-sand-50"
              :disabled="busy"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-xl bg-cta px-4 py-2 text-sm font-medium text-white transition hover:bg-cta-hover disabled:opacity-50"
              :disabled="busy || preview.importableCount === 0"
              @click="confirmImport"
            >
              <Icon v-if="busy" name="lucide:loader-2" class="h-4 w-4 animate-spin" />
              {{ busy ? "Importing..." : `Import ${preview.importableCount} flight(s)` }}
            </button>
          </div>
        </div>

        <div v-else-if="phase === 'result' && result" class="mt-4 space-y-4">
          <p aria-live="polite" class="text-sm text-sand-700">
            Imported <strong>{{ result.imported }}</strong> · Skipped
            <strong>{{ result.skipped }}</strong> · Failed
            <strong>{{ result.failed }}</strong>
          </p>
          <details
            v-if="result.issues.length > 0"
            class="rounded-xl border border-sand-200 p-3 text-xs"
          >
            <summary class="cursor-pointer text-sand-600">
              {{ result.issues.length }} issue(s)
            </summary>
            <ul class="mt-2 space-y-1 text-sand-600">
              <li v-for="issue in result.issues" :key="`${issue.line}-${issue.reason}`">
                Line {{ issue.line }}: {{ issue.reason }}
              </li>
            </ul>
          </details>
          <div class="flex justify-end">
            <button
              type="button"
              class="rounded-xl bg-cta px-4 py-2 text-sm font-medium text-white hover:bg-cta-hover"
              @click="close"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
