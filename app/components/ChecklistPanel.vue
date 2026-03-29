<script setup lang="ts">
interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  sortOrder: number;
}

interface Checklist {
  id: string;
  name: string;
  items: ChecklistItem[];
}

const props = defineProps<{
  tripId: string;
}>();

const { data: checklists, refresh } = await useFetch<Checklist[]>(
  `/api/trips/${props.tripId}/checklists`
);

const expandedLists = ref<Set<string>>(new Set());
const newListName = ref("");
const newItemTexts = ref<Record<string, string>>({});
const editingListId = ref<string | null>(null);
const editingListName = ref("");
const editingItemId = ref<string | null>(null);
const editingItemText = ref("");

function toggleList(id: string) {
  if (expandedLists.value.has(id)) {
    expandedLists.value.delete(id);
  } else {
    expandedLists.value.add(id);
  }
}

async function createChecklist() {
  const name = newListName.value.trim();
  if (!name) return;
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists`, {
      method: "POST",
      body: { name },
    });
    newListName.value = "";
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to create checklist:", e);
  }
}

const { confirm } = useConfirm();

async function deleteChecklist(checklistId: string) {
  const ok = await confirm({
    title: "Delete checklist",
    message: "Delete this checklist and all its items?",
    confirmText: "Delete",
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists/${checklistId}`, {
      method: "DELETE",
    });
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to delete checklist:", e);
  }
}

function startEditList(checklist: Checklist) {
  editingListId.value = checklist.id;
  editingListName.value = checklist.name;
}

async function saveListName(checklistId: string) {
  const name = editingListName.value.trim();
  if (!name) return;
  try {
    await $fetch(`/api/trips/${props.tripId}/checklists/${checklistId}`, {
      method: "PUT",
      body: { name },
    });
    editingListId.value = null;
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to update checklist:", e);
  }
}

async function toggleItem(checklistId: string, item: ChecklistItem) {
  try {
    await $fetch(
      `/api/trips/${props.tripId}/checklists/${checklistId}/items/${item.id}`,
      {
        method: "PUT",
        body: { checked: !item.checked },
      }
    );
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to toggle item:", e);
  }
}

async function addItem(checklistId: string) {
  const text = (newItemTexts.value[checklistId] ?? "").trim();
  if (!text) return;
  try {
    await $fetch(
      `/api/trips/${props.tripId}/checklists/${checklistId}/items`,
      {
        method: "POST",
        body: { text },
      }
    );
    newItemTexts.value[checklistId] = "";
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to add item:", e);
  }
}

function startEditItem(item: ChecklistItem) {
  editingItemId.value = item.id;
  editingItemText.value = item.text;
}

async function saveItemText(checklistId: string, itemId: string) {
  const text = editingItemText.value.trim();
  if (!text) return;
  try {
    await $fetch(
      `/api/trips/${props.tripId}/checklists/${checklistId}/items/${itemId}`,
      { method: "PUT", body: { text } }
    );
    editingItemId.value = null;
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to update item:", e);
  }
}

async function deleteItem(checklistId: string, itemId: string) {
  try {
    await $fetch(
      `/api/trips/${props.tripId}/checklists/${checklistId}/items/${itemId}`,
      {
        method: "DELETE",
      }
    );
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to delete item:", e);
  }
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
        class="block flex-1 rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
        @keydown.enter="createChecklist"
      />
      <button
        class="rounded-lg bg-terra-500 px-3 py-2 text-sm font-medium text-white hover:bg-terra-600"
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
            </template>
          </button>
          <div class="flex gap-1">
            <button
              class="rounded p-1 text-sand-400 hover:bg-sand-100 hover:text-sand-600"
              title="Edit name"
              @click.stop="startEditList(checklist)"
            >
              <Icon name="lucide:edit" class="h-3.5 w-3.5" />
            </button>
            <button
              class="rounded p-1 text-sand-400 hover:bg-red-50 hover:text-red-600"
              title="Delete"
              @click.stop="deleteChecklist(checklist.id)"
            >
              <Icon name="lucide:trash-2" class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- Items -->
        <div v-if="expandedLists.has(checklist.id)" class="border-t border-sand-200 px-3 py-2">
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
                @click.prevent
              />
              <span
                v-else
                class="min-w-0 truncate"
                :class="item.checked ? 'text-sand-400 line-through' : 'text-sand-700'"
                @dblclick.prevent="startEditItem(item)"
              >
                {{ item.text }}
              </span>
            </label>
            <button
              class="rounded p-0.5 text-sand-300 hover:text-red-500"
              @click="deleteItem(checklist.id, item.id)"
            >
              <Icon name="lucide:x" class="h-3.5 w-3.5" />
            </button>
          </div>

          <!-- Add item -->
          <div class="mt-1">
            <input
              v-model="newItemTexts[checklist.id]"
              type="text"
              placeholder="Add item..."
              class="block w-full rounded border border-sand-200 px-2 py-1 text-sm input-focus"
              @keydown.enter="addItem(checklist.id)"
            />
          </div>
        </div>
      </div>
    </div>

    <p v-else class="mt-4 text-center text-xs text-sand-400">
      No checklists yet. Create one above.
    </p>
  </div>
</template>
