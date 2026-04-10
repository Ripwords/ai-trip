<script setup lang="ts">
const { isOpen, options, handleConfirm, handleCancel } = useConfirm()
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="fixed inset-0 bg-black/40" @click="handleCancel" />
        <div class="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl mx-4">
          <h3 class="text-base font-display text-sand-900">
            {{ options.title }}
          </h3>
          <p class="mt-2 text-sm text-sand-500">
            {{ options.message }}
          </p>
          <div class="mt-5 flex justify-end gap-3">
            <button
              class="rounded-lg border border-sand-300 px-4 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
              @click="handleCancel"
            >
              {{ options.cancelText || "Cancel" }}
            </button>
            <button
              class="rounded-lg px-4 py-2 text-sm font-medium text-white"
              :class="
                options.destructive
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-terra-500 hover:bg-terra-600'
              "
              @click="handleConfirm"
            >
              {{ options.confirmText || "Confirm" }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
