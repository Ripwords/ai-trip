<template>
  <div class="space-y-8">
    <!-- Stats strip skeleton -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div v-for="i in 6" :key="i" class="rounded-2xl border border-sand-200 bg-white p-4">
        <Skeleton variant="text" width="60%" height="12px" />
        <Skeleton variant="text" width="40%" height="28px" class="mt-2" />
      </div>
    </div>

    <!-- Next flight banner skeleton -->
    <div class="rounded-2xl border border-sand-200 bg-white p-5">
      <div class="flex items-center gap-4">
        <Skeleton variant="circle" width="44px" height="44px" />
        <div class="flex-1 space-y-2">
          <Skeleton variant="text" width="30%" height="14px" />
          <Skeleton variant="text" width="50%" height="20px" />
        </div>
        <Skeleton variant="block" width="100px" height="36px" rounded="12px" />
      </div>
    </div>

    <!-- Trip cards grid skeleton -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="i in 6"
        :key="i"
        class="rounded-2xl border border-sand-200 bg-white p-5"
        :style="{ animationDelay: `${i * 80}ms` }"
      >
        <div class="flex items-start justify-between">
          <Skeleton variant="text" width="55%" height="22px" />
          <Skeleton variant="block" width="70px" height="24px" rounded="20px" />
        </div>
        <Skeleton variant="text" width="40%" height="13px" class="mt-3" />
        <div class="mt-4 flex gap-2">
          <Skeleton variant="block" width="60px" height="28px" rounded="8px" />
          <Skeleton variant="block" width="80px" height="28px" rounded="8px" />
        </div>
      </div>
    </div>
  </div>
</template>
