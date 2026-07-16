<script setup lang="ts">
import type { Toast, ToastType } from "../composables/useToast"

const { toasts, dismiss } = useToast()

function icon(type: ToastType) {
  if (type === "success") return "lucide:check-circle"
  if (type === "error") return "lucide:alert-circle"
  return "lucide:info"
}

// Named handler: an inline multi-statement @click gets reformatted into
// newline-separated statements the Vue template parser can't parse.
function runAction(t: Toast) {
  t.action?.onClick()
  dismiss(t.id)
}
</script>

<template>
  <Teleport to="body">
    <!-- aria-live=polite for info/success; individual error toasts use role=alert (assertive) -->
    <div
      class="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end sm:pb-4"
      aria-live="polite"
    >
      <TransitionGroup
        enter-active-class="duration-200 ease-out motion-reduce:transition-none"
        enter-from-class="translate-y-2 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="absolute duration-150 ease-in motion-reduce:transition-none"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-for="t in toasts"
          :key="t.id"
          :role="t.type === 'error' ? 'alert' : 'status'"
          class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white px-4 py-3 shadow-lg"
          :class="{
            'border-forest-200': t.type === 'success',
            'border-red-200': t.type === 'error',
            'border-sand-200': t.type === 'info',
          }"
        >
          <Icon
            :name="icon(t.type)"
            class="mt-0.5 h-5 w-5 shrink-0"
            :class="{
              'text-forest-500': t.type === 'success',
              'text-red-500': t.type === 'error',
              'text-sand-500': t.type === 'info',
            }"
          />
          <p class="flex-1 text-sm text-sand-800">{{ t.message }}</p>
          <button
            v-if="t.action"
            type="button"
            class="focus-ring shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-terra-600 transition hover:text-terra-800"
            @click="runAction(t)"
          >
            {{ t.action.label }}
          </button>
          <button
            type="button"
            class="focus-ring -m-1 shrink-0 rounded-lg p-1 text-sand-400 transition hover:text-sand-700"
            aria-label="Dismiss notification"
            @click="dismiss(t.id)"
          >
            <Icon name="lucide:x" class="h-4 w-4" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
