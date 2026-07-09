<script setup lang="ts">
defineProps<{
  /** Shape variant */
  variant?: "text" | "circle" | "card" | "block"
  /** Width — any CSS value. Defaults: text=100%, circle=40px, card=100%, block=100% */
  width?: string
  /** Height — any CSS value. Defaults: text=16px, circle=40px, card=180px, block=48px */
  height?: string
  /** Border radius override */
  rounded?: string
}>()
</script>

<template>
  <div
    aria-hidden="true"
    class="skeleton-shimmer"
    :class="{
      'h-4 w-full rounded-md': variant === 'text' || !variant,
      'h-10 w-10 rounded-full': variant === 'circle',
      'h-[180px] w-full rounded-2xl': variant === 'card',
      'h-12 w-full rounded-xl': variant === 'block',
    }"
    :style="{
      width: width || undefined,
      height: height || undefined,
      borderRadius: rounded || undefined,
    }"
  />
</template>

<style scoped>
.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    var(--color-sand-100) 0%,
    var(--color-sand-200) 40%,
    var(--color-sand-100) 80%
  );
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
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
