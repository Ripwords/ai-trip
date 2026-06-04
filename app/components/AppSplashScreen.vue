<script setup lang="ts">
const MIN_VISIBLE_MS = 850
const EXIT_MS = 260
const HARD_HIDE_MS = 3000

const visible = ref(true)
const leaving = ref(false)

onMounted(() => {
  const hide = () => {
    leaving.value = true
    window.setTimeout(() => {
      visible.value = false
    }, EXIT_MS)
  }

  window.setTimeout(hide, MIN_VISIBLE_MS)
  window.setTimeout(() => {
    visible.value = false
  }, HARD_HIDE_MS)
})
</script>

<template>
  <Transition name="app-splash">
    <div
      v-if="visible"
      class="app-splash-screen"
      :class="{ 'app-splash-screen--leaving': leaving }"
      role="status"
      aria-live="polite"
      aria-label="Loading AI Trip"
    >
      <div class="app-splash-screen__mark">
        <img src="/image.png" alt="AI Trip" class="app-splash-screen__logo" />
      </div>
      <div class="app-splash-screen__copy">
        <p class="app-splash-screen__title">AI Trip</p>
        <div class="app-splash-screen__bar" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.app-splash-screen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 18px;
  padding: max(32px, env(safe-area-inset-top)) 24px max(32px, env(safe-area-inset-bottom));
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(250, 248, 245, 0.96), rgba(243, 239, 232, 0.98)), #faf8f5;
  color: #3d3328;
  opacity: 1;
  visibility: visible;
  animation: app-splash-fallback 260ms ease 3s forwards;
}

.app-splash-screen--leaving,
.app-splash-leave-active {
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 260ms ease,
    visibility 260ms ease;
}

.app-splash-screen__mark {
  display: grid;
  height: 76px;
  width: 76px;
  place-items: center;
  border: 1px solid rgba(232, 93, 58, 0.18);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.64);
  box-shadow: 0 18px 44px rgba(61, 51, 40, 0.12);
}

.app-splash-screen__logo {
  height: 52px;
  width: 52px;
  border-radius: 14px;
  object-fit: cover;
}

.app-splash-screen__copy {
  display: grid;
  justify-items: center;
  gap: 14px;
  min-width: min(220px, 72vw);
}

.app-splash-screen__title {
  margin: 0;
  font-family: var(--font-display), serif;
  font-size: 1.75rem;
  line-height: 1;
  color: #3d3328;
}

.app-splash-screen__bar {
  position: relative;
  height: 3px;
  width: 128px;
  overflow: hidden;
  border-radius: 9999px;
  background: rgba(212, 200, 184, 0.8);
}

.app-splash-screen__bar span {
  position: absolute;
  inset: 0;
  width: 42%;
  border-radius: inherit;
  background: linear-gradient(90deg, #e85d3a, #2e8a9e);
  animation: app-splash-progress 900ms ease-in-out infinite;
}

.dark .app-splash-screen {
  background: linear-gradient(180deg, rgba(26, 23, 20, 0.97), rgba(35, 32, 27, 0.98)), #1a1714;
  color: #f3efe8;
}

.dark .app-splash-screen__mark {
  border-color: rgba(240, 123, 90, 0.22);
  background: rgba(30, 27, 24, 0.72);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.32);
}

.dark .app-splash-screen__title {
  color: #f3efe8;
}

.dark .app-splash-screen__bar {
  background: rgba(110, 92, 70, 0.75);
}

@keyframes app-splash-progress {
  0% {
    transform: translateX(-110%);
  }
  50% {
    transform: translateX(70%);
  }
  100% {
    transform: translateX(260%);
  }
}

@keyframes app-splash-fallback {
  to {
    opacity: 0;
    visibility: hidden;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-splash-screen__bar span {
    animation: none;
  }

  .app-splash-screen {
    animation-duration: 1ms;
  }

  .app-splash-screen--leaving,
  .app-splash-leave-active {
    transition: none;
  }
}
</style>
