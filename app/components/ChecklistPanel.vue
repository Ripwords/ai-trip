<script setup lang="ts">
interface ChecklistItem {
  id: string
  text: string
  checked: boolean
  sortOrder: number
  category: string | null
}

interface Checklist {
  id: string
  name: string
  items: ChecklistItem[]
}

interface PackingTemplate {
  id: string
  name: string
  description: string | null
  isGlobal: boolean
  items: { text: string; category: string }[]
}

const props = defineProps<{
  tripId: string
}>()

const { data: checklists, refresh } = await useFetch<Checklist[]>(
  `/api/trips/${props.tripId}/checklists`,
)

const expandedLists = ref<Set<string>>(new Set())
const newListName = ref("")
const newItemTexts = ref<Record<string, string>>({})
const newItemCategories = ref<Record<string, string>>({})
const editingListId = ref<string | null>(null)
const editingListName = ref("")
const editingItemId = ref<string | null>(null)
const editingItemText = ref("")

// Template state
const showTemplateModal = ref(false)
const templateTargetChecklistId = ref<string | null>(null)
const templates = ref<PackingTemplate[]>([])
const showSaveTemplateForm = ref<string | null>(null)
const saveTemplateName = ref("")

function toggleList(id: string) {
  if (expandedLists.value.has(id)) {
    expandedLists.value.delete(id)
  } else {
    expandedLists.value.add(id)
  }
}

// Compute unique categories across all items for datalist suggestions
const allCategories = computed(() => {
  const cats = new Set<string>()
  checklists.value?.forEach((cl) => {
    cl.items.forEach((item) => {
      if (item.category) cats.add(item.category)
    })
  })
  return Array.from(cats).toSorted()
})

// Group items by category
function groupByCategory(items: ChecklistItem[]): { category: string; items: ChecklistItem[] }[] {
  const groups: Record<string, ChecklistItem[]> = {}
  for (const item of items) {
    const cat = item.category || "Uncategorized"
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(item)
  }
  return Object.entries(groups).map(([category, items]) => ({ category, items }))
}

const categoryColors: Record<string, string> = {
  Clothes: "bg-ocean-50 text-ocean-700",
  Toiletries: "bg-terra-50 text-terra-600",
  Electronics: "bg-ocean-50 text-ocean-700",
  Documents: "bg-sand-200 text-sand-700",
  Gear: "bg-forest-50 text-forest-700",
  Accessories: "bg-terra-50 text-terra-700",
}

function getCategoryClass(category: string): string {
  return categoryColors[category] || "bg-sand-100 text-sand-600"
}

async function createChecklist() {
  const name = newListName.value.trim()
  if (!name) return
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists`, {
      method: "POST",
      body: { name },
    })
    newListName.value = ""
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to create checklist:", e)
  }
}

const { confirm } = useConfirm()

async function deleteChecklist(checklistId: string) {
  const ok = await confirm({
    title: "Delete checklist",
    message: "Delete this checklist and all its items?",
    confirmText: "Delete",
    destructive: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists/${checklistId}`, {
      method: "DELETE",
    })
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to delete checklist:", e)
  }
}

function startEditList(checklist: Checklist) {
  editingListId.value = checklist.id
  editingListName.value = checklist.name
}

async function saveListName(checklistId: string) {
  const name = editingListName.value.trim()
  if (!name) return
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists/${checklistId}`, {
      method: "PUT",
      body: { name },
    })
    editingListId.value = null
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to update checklist:", e)
  }
}

async function toggleItem(checklistId: string, item: ChecklistItem) {
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists/${checklistId}/items/${item.id}`, {
      method: "PUT",
      body: { checked: !item.checked },
    })
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to toggle item:", e)
  }
}

async function addItem(checklistId: string) {
  const text = (newItemTexts.value[checklistId] ?? "").trim()
  if (!text) return
  const category = (newItemCategories.value[checklistId] ?? "").trim() || undefined
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists/${checklistId}/items`, {
      method: "POST",
      body: { text, category },
    })
    newItemTexts.value[checklistId] = ""
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to add item:", e)
  }
}

function startEditItem(item: ChecklistItem) {
  editingItemId.value = item.id
  editingItemText.value = item.text
}

async function saveItemText(checklistId: string, itemId: string) {
  const text = editingItemText.value.trim()
  if (!text) return
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists/${checklistId}/items/${itemId}`, {
      method: "PUT",
      body: { text },
    })
    editingItemId.value = null
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to update item:", e)
  }
}

async function deleteItem(checklistId: string, itemId: string) {
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists/${checklistId}/items/${itemId}`, {
      method: "DELETE",
    })
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to delete item:", e)
  }
}

// Template functions
async function openTemplateModal(checklistId: string) {
  templateTargetChecklistId.value = checklistId
  try {
    templates.value = await $fetch<PackingTemplate[]>("/api/packing-templates")
  } catch (e: unknown) {
    console.error("Failed to load templates:", e)
    templates.value = []
  }
  showTemplateModal.value = true
}

async function loadTemplate(templateId: string) {
  if (!templateTargetChecklistId.value) return
  try {
    await $fetch(
      `/api/trips/${props.tripId}/checklists/${templateTargetChecklistId.value}/load-template`,
      {
        method: "POST",
        body: { templateId },
      },
    )
    showTemplateModal.value = false
    expandedLists.value.add(templateTargetChecklistId.value)
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to load template:", e)
  }
}

async function saveAsTemplate(checklistId: string) {
  const name = saveTemplateName.value.trim()
  if (!name) return
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists/${checklistId}/save-as-template`, {
      method: "POST",
      body: { name },
    })
    showSaveTemplateForm.value = null
    saveTemplateName.value = ""
  } catch (e: unknown) {
    console.error("Failed to save template:", e)
  }
}

function checkedCount(checklist: Checklist): number {
  return checklist.items.filter((i) => i.checked).length
}
</script>

<template>
  <div class="rounded-2xl border border-sand-200 bg-white p-6">
    <h3 class="text-sm font-semibold text-sand-900">Checklists</h3>

    <!-- Create new -->
    <div class="mt-4 flex gap-2">
      <input
        v-model="newListName"
        type="text"
        placeholder="New checklist name..."
        class="block min-h-11 flex-1 rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
        @keydown.enter="createChecklist"
      />
      <button
        class="inline-flex min-h-11 items-center rounded-lg bg-cta px-3 text-sm font-medium text-white hover:bg-cta-hover"
        @click="createChecklist"
      >
        Add
      </button>
    </div>

    <!-- Lists -->
    <div v-if="checklists?.length" class="mt-4 space-y-3">
      <div
        v-for="checklist in checklists"
        :key="checklist.id"
        class="rounded-lg border border-sand-200"
      >
        <!-- List header -->
        <div class="flex items-center justify-between px-3 py-2">
          <button
            class="flex items-center gap-2 text-sm font-medium text-sand-900"
            @click="toggleList(checklist.id)"
          >
            <Icon
              name="lucide:chevron-right"
              class="h-3.5 w-3.5 text-sand-400 transition-transform"
              :class="{ 'rotate-90': expandedLists.has(checklist.id) }"
            />
            <template v-if="editingListId === checklist.id">
              <input
                v-model="editingListName"
                type="text"
                class="rounded border border-sand-300 px-2 py-0.5 text-sm input-focus"
                @keydown.enter="saveListName(checklist.id)"
                @blur="saveListName(checklist.id)"
                @click.stop
              />
            </template>
            <template v-else>
              {{ checklist.name }}
              <span v-if="checklist.items.length" class="text-xs font-normal text-sand-700">
                ({{ checkedCount(checklist) }}/{{ checklist.items.length }})
              </span>
            </template>
          </button>
          <div class="flex">
            <button
              type="button"
              class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 hover:bg-ocean-50 hover:text-ocean-600 focus-ring"
              title="Load from template"
              aria-label="Load from template"
              @click.stop="openTemplateModal(checklist.id)"
            >
              <Icon name="lucide:package-plus" class="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 hover:bg-forest-50 hover:text-forest-600 focus-ring"
              title="Save as template"
              aria-label="Save as template"
              @click.stop="
                () => {
                  showSaveTemplateForm = showSaveTemplateForm === checklist.id ? null : checklist.id
                  saveTemplateName = checklist.name
                }
              "
            >
              <Icon name="lucide:save" class="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 hover:bg-sand-100 hover:text-sand-600 focus-ring"
              title="Edit name"
              aria-label="Edit checklist name"
              @click.stop="startEditList(checklist)"
            >
              <Icon name="lucide:edit" class="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 hover:bg-red-50 hover:text-red-600 focus-ring"
              title="Delete"
              aria-label="Delete checklist"
              @click.stop="deleteChecklist(checklist.id)"
            >
              <Icon name="lucide:trash-2" class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- Save as template inline form -->
        <div
          v-if="showSaveTemplateForm === checklist.id"
          class="border-t border-sand-200 px-3 py-2"
        >
          <form class="flex gap-2" @submit.prevent="saveAsTemplate(checklist.id)">
            <input
              v-model="saveTemplateName"
              type="text"
              placeholder="Template name..."
              class="block flex-1 rounded-lg border border-sand-300 px-2 py-1.5 text-sm input-focus"
            />
            <button
              type="submit"
              class="rounded-lg bg-cta px-3 py-1.5 text-xs font-medium text-white hover:bg-cta-hover"
            >
              Save
            </button>
            <button
              type="button"
              class="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-medium text-sand-600 hover:bg-sand-50"
              @click="showSaveTemplateForm = null"
            >
              Cancel
            </button>
          </form>
        </div>

        <!-- Items -->
        <div v-if="expandedLists.has(checklist.id)" class="border-t border-sand-200 px-3 py-2">
          <!-- Group by category if any items have categories -->
          <template v-if="checklist.items.some((i) => i.category)">
            <div
              v-for="group in groupByCategory(checklist.items)"
              :key="group.category"
              class="mb-2 last:mb-0"
            >
              <div class="mb-1 flex items-center gap-1.5">
                <span
                  class="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                  :class="getCategoryClass(group.category)"
                >
                  {{ group.category }}
                </span>
              </div>
              <div
                v-for="item in group.items"
                :key="item.id"
                class="flex items-center justify-between py-1 pl-1"
              >
                <label class="flex items-center gap-2 text-sm cursor-pointer min-w-0">
                  <input
                    type="checkbox"
                    :checked="item.checked"
                    class="shrink-0 rounded border-sand-300 text-terra-500 focus:ring-terra-500"
                    @change="toggleItem(checklist.id, item)"
                  />
                  <input
                    v-if="editingItemId === item.id"
                    v-model="editingItemText"
                    type="text"
                    class="min-w-0 flex-1 rounded border border-sand-300 px-1.5 py-0.5 text-sm input-focus"
                    @keydown.enter="saveItemText(checklist.id, item.id)"
                    @blur="saveItemText(checklist.id, item.id)"
                    @click.stop
                  />
                  <span
                    v-else
                    class="min-w-0 truncate"
                    :class="item.checked ? 'text-sand-700 line-through' : 'text-sand-700'"
                    @dblclick.prevent="startEditItem(item)"
                  >
                    {{ item.text }}
                  </span>
                </label>
                <div class="flex shrink-0 items-center">
                  <button
                    v-if="editingItemId !== item.id"
                    type="button"
                    class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 hover:text-terra-500 focus-ring"
                    title="Edit item"
                    aria-label="Edit item"
                    @click="startEditItem(item)"
                  >
                    <Icon name="lucide:edit" class="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 hover:text-red-500 focus-ring"
                    title="Delete item"
                    aria-label="Delete item"
                    @click="deleteItem(checklist.id, item.id)"
                  >
                    <Icon name="lucide:x" class="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- Flat list (no categories) -->
          <template v-else>
            <div
              v-for="item in checklist.items"
              :key="item.id"
              class="flex items-center justify-between py-1"
            >
              <label class="flex items-center gap-2 text-sm cursor-pointer min-w-0">
                <input
                  type="checkbox"
                  :checked="item.checked"
                  class="shrink-0 rounded border-sand-300 text-terra-500 focus:ring-terra-500"
                  @change="toggleItem(checklist.id, item)"
                />
                <input
                  v-if="editingItemId === item.id"
                  v-model="editingItemText"
                  type="text"
                  class="min-w-0 flex-1 rounded border border-sand-300 px-1.5 py-0.5 text-sm input-focus"
                  @keydown.enter="saveItemText(checklist.id, item.id)"
                  @blur="saveItemText(checklist.id, item.id)"
                  @click.stop
                />
                <span
                  v-else
                  class="min-w-0 truncate"
                  :class="item.checked ? 'text-sand-700 line-through' : 'text-sand-700'"
                  @dblclick.prevent="startEditItem(item)"
                >
                  {{ item.text }}
                </span>
              </label>
              <div class="flex shrink-0 items-center">
                <button
                  v-if="editingItemId !== item.id"
                  type="button"
                  class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 hover:text-terra-500 focus-ring"
                  title="Edit item"
                  aria-label="Edit item"
                  @click="startEditItem(item)"
                >
                  <Icon name="lucide:edit" class="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 hover:text-red-500 focus-ring"
                  title="Delete item"
                  aria-label="Delete item"
                  @click="deleteItem(checklist.id, item.id)"
                >
                  <Icon name="lucide:x" class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </template>

          <!-- Add item -->
          <div class="mt-1 flex gap-1.5">
            <input
              v-model="newItemTexts[checklist.id]"
              type="text"
              placeholder="Add item..."
              class="block flex-1 rounded border border-sand-200 px-2 py-1 text-sm input-focus"
              @keydown.enter="addItem(checklist.id)"
            />
            <input
              v-model="newItemCategories[checklist.id]"
              type="text"
              list="category-suggestions"
              placeholder="Category"
              class="block w-24 rounded border border-sand-200 px-2 py-1 text-xs input-focus"
            />
          </div>
        </div>
      </div>
    </div>

    <p v-else class="mt-4 text-center text-xs text-sand-700">
      No checklists yet. Create one above.
    </p>

    <!-- Category datalist -->
    <datalist id="category-suggestions">
      <option v-for="cat in allCategories" :key="cat" :value="cat" />
    </datalist>

    <!-- Template selection modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="showTemplateModal" class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="fixed inset-0 bg-black/40" @click="showTemplateModal = false" />
          <div class="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl mx-4">
            <div class="flex items-center justify-between">
              <h3 class="font-display text-lg text-sand-900">Load Template</h3>
              <button
                class="rounded p-1 text-sand-400 hover:text-sand-600"
                @click="showTemplateModal = false"
              >
                <Icon name="lucide:x" class="h-4 w-4" />
              </button>
            </div>
            <p class="mt-1 text-xs text-sand-500">
              Items will be added to your checklist. Existing items are kept.
            </p>

            <div v-if="templates.length" class="mt-4 max-h-80 space-y-2 overflow-y-auto">
              <button
                v-for="tmpl in templates"
                :key="tmpl.id"
                class="w-full rounded-xl border border-sand-200 p-3 text-left transition hover:border-terra-300 hover:bg-terra-50/30"
                @click="loadTemplate(tmpl.id)"
              >
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-sand-900">{{ tmpl.name }}</span>
                  <span class="flex items-center gap-1 text-xs text-sand-700">
                    <Icon
                      v-if="tmpl.isGlobal"
                      name="lucide:globe"
                      class="h-3 w-3"
                      title="Built-in template"
                    />
                    {{ tmpl.items.length }} items
                  </span>
                </div>
                <p v-if="tmpl.description" class="mt-0.5 text-xs text-sand-500">
                  {{ tmpl.description }}
                </p>
              </button>
            </div>
            <p v-else class="mt-4 text-center text-sm text-sand-700">No templates available yet.</p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
