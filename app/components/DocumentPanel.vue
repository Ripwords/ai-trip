<script setup lang="ts">
interface Document {
  id: string
  name: string
  url: string
  size: number
  mimeType: string
  reservationId: string | null
  uploadedBy: { id: string; name: string; image: string | null } | null
  createdAt: string
}

const props = defineProps<{
  tripId: string
}>()

const { data: documents, refresh } = await useFetch<Document[]>(
  `/api/trips/${props.tripId}/documents`,
)

const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function getFileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "lucide:file-text"
  if (mimeType.startsWith("image/")) return "lucide:image"
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
    return "lucide:file-spreadsheet"
  if (mimeType.includes("word") || mimeType.includes("document")) return "lucide:file-type"
  return "lucide:file"
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploading.value = true
  try {
    const formData = new FormData()
    formData.append("file", file)

    await $fetch(`/api/trips/${props.tripId}/documents`, {
      method: "POST",
      body: formData,
    })
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to upload document:", e)
  } finally {
    uploading.value = false
    // Reset file input
    if (fileInput.value) fileInput.value.value = ""
  }
}

const { confirm } = useConfirm()

async function deleteDocument(docId: string) {
  const ok = await confirm({
    title: "Delete document",
    message: "Delete this document? This cannot be undone.",
    confirmText: "Delete",
    destructive: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/trips/${props.tripId}/documents/${docId}`, {
      method: "DELETE",
    })
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to delete document:", e)
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-sand-900">Documents</h3>
        <button
          :disabled="uploading"
          class="inline-flex items-center gap-1 rounded-lg bg-terra-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-terra-600 disabled:opacity-50"
          @click="fileInput?.click()"
        >
          <Icon
            :name="uploading ? 'lucide:loader' : 'lucide:upload'"
            class="h-3 w-3"
            :class="{ 'animate-spin': uploading }"
          />
          {{ uploading ? "Uploading..." : "Upload" }}
        </button>
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv"
          @change="handleUpload"
        />
      </div>

      <p class="mt-1 text-xs text-sand-400">
        Boarding passes, booking confirmations, visa docs, and more. Max 10MB per file.
      </p>

      <!-- Document list -->
      <div v-if="documents?.length" class="mt-4 space-y-2">
        <div
          v-for="doc in documents"
          :key="doc.id"
          class="flex items-center justify-between rounded-xl border border-sand-200 px-3 py-2"
        >
          <a
            :href="doc.url"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition"
          >
            <Icon :name="getFileIcon(doc.mimeType)" class="h-5 w-5 shrink-0 text-sand-500" />
            <div class="min-w-0">
              <p class="text-sm font-medium text-sand-900 truncate">{{ doc.name }}</p>
              <div class="flex items-center gap-2 text-xs text-sand-400">
                <span>{{ formatFileSize(doc.size) }}</span>
                <span v-if="doc.uploadedBy">by {{ doc.uploadedBy.name }}</span>
                <NuxtTime
                  :datetime="doc.createdAt"
                  locale="en-US"
                  month="short"
                  day="numeric"
                  year="numeric"
                />
              </div>
            </div>
          </a>
          <button
            class="shrink-0 rounded p-1 text-sand-300 hover:text-red-500"
            title="Delete"
            @click="deleteDocument(doc.id)"
          >
            <Icon name="lucide:trash-2" class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p v-else class="mt-4 text-center text-xs text-sand-400">No documents uploaded yet.</p>
    </div>
  </div>
</template>
