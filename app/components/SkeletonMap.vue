<script setup lang="ts">
defineProps<{
  mode: "2d" | "3d"
}>()
</script>

<template>
  <div class="relative w-full overflow-hidden rounded-2xl border border-sand-200">
    <!-- 2D skeleton: matches ScratchMap's 960×600 aspect ratio -->
    <div v-if="mode === '2d'" class="aspect-[960/600] w-full">
      <!-- Ocean background -->
      <div class="skeleton-shimmer-subtle h-full w-full rounded-2xl" />

      <!-- Faint continent blobs -->
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div class="grid h-[70%] w-[85%] grid-cols-5 grid-rows-3 gap-3">
          <Skeleton variant="block" rounded="12px" class="col-span-1 row-span-2 !h-full opacity-40" />
          <Skeleton variant="block" rounded="14px" class="col-span-2 row-span-1 !h-full opacity-30" />
          <Skeleton variant="block" rounded="10px" class="col-span-1 row-span-2 !h-full opacity-35" />
          <Skeleton variant="block" rounded="16px" class="col-span-1 row-span-1 !h-full opacity-25" />
          <Skeleton variant="block" rounded="12px" class="col-span-1 row-span-1 !h-full opacity-30" />
          <Skeleton variant="block" rounded="10px" class="col-span-1 row-span-1 !h-full opacity-20" />
        </div>
      </div>
    </div>

    <!-- 3D skeleton: matches GlobeScratchMap's fixed heights -->
    <div v-else class="h-[500px] sm:h-[600px]">
      <div class="skeleton-shimmer-subtle h-full w-full rounded-2xl" />

      <!-- Globe circle hint -->
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="skeleton-shimmer aspect-square w-[60%] max-w-[360px] rounded-full opacity-40" />
      </div>
    </div>

    <!-- Fake toggle button (top-right) -->
    <div class="absolute right-3 top-3 flex flex-col gap-1.5">
      <Skeleton variant="block" width="2rem" height="2rem" rounded="0.5rem" class="hidden sm:block" />
      <Skeleton variant="block" width="2.75rem" height="2.75rem" rounded="0.75rem" class="sm:hidden" />
    </div>

    <!-- Fake fullscreen button (top-left) -->
    <div class="absolute left-3 top-3">
      <Skeleton variant="block" width="2rem" height="2rem" rounded="0.5rem" class="hidden sm:block" />
      <Skeleton variant="block" width="2.75rem" height="2.75rem" rounded="0.75rem" class="sm:hidden" />
    </div>

    <!-- Fake stats overlay (bottom-left) -->
    <div class="absolute bottom-3 left-3">
      <Skeleton variant="block" width="160px" height="32px" rounded="0.75rem" />
    </div>
  </div>
</template>

<style scoped>
.skeleton-shimmer-subtle {
  background: linear-gradient(
    90deg,
    var(--color-sand-100) 0%,
    var(--color-sand-150, var(--color-sand-200)) 40%,
    var(--color-sand-100) 80%
  );
  background-size: 200% 100%;
  animation: shimmer 2.2s ease-in-out infinite;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
