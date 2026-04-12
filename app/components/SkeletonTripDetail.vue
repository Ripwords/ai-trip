<template>
  <div class="space-y-6">
    <!-- Header skeleton -->
    <div>
      <div class="flex items-center gap-3">
        <Skeleton variant="circle" width="32px" height="32px" rounded="10px" />
        <Skeleton variant="text" width="200px" height="28px" />
      </div>
      <div class="mt-2 flex flex-wrap gap-2">
        <Skeleton variant="text" width="140px" height="14px" />
        <Skeleton variant="block" width="80px" height="24px" rounded="20px" />
      </div>
      <!-- Tab-like pill buttons -->
      <div class="mt-4 flex gap-2">
        <Skeleton
          v-for="i in 5"
          :key="i"
          variant="block"
          :width="['60px', '80px', '70px', '90px', '65px'][i - 1]"
          height="32px"
          rounded="20px"
        />
      </div>
    </div>

    <!-- Tabs skeleton -->
    <div class="flex gap-1 overflow-hidden rounded-xl border border-sand-200 bg-sand-100 p-1">
      <Skeleton
        v-for="i in 6"
        :key="i"
        variant="block"
        height="32px"
        rounded="8px"
        class="flex-1"
      />
    </div>

    <!-- Content area skeleton (overview-like) -->
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="rounded-2xl border border-sand-200 bg-white p-5 space-y-3">
        <Skeleton variant="text" width="40%" height="16px" />
        <Skeleton variant="text" height="14px" />
        <Skeleton variant="text" height="14px" />
        <Skeleton variant="text" width="70%" height="14px" />
      </div>
      <div class="rounded-2xl border border-sand-200 bg-white p-5 space-y-3">
        <Skeleton variant="text" width="50%" height="16px" />
        <div class="grid grid-cols-2 gap-3">
          <div v-for="i in 4" :key="i" class="space-y-1">
            <Skeleton variant="text" width="60%" height="12px" />
            <Skeleton variant="text" width="40%" height="20px" />
          </div>
        </div>
      </div>
    </div>

    <!-- Activities list skeleton -->
    <div class="space-y-3">
      <div v-for="i in 3" :key="i" class="rounded-2xl border border-sand-200 bg-white p-4">
        <div class="flex items-start gap-3">
          <Skeleton variant="circle" width="36px" height="36px" rounded="10px" />
          <div class="flex-1 space-y-2">
            <Skeleton variant="text" width="60%" height="16px" />
            <Skeleton variant="text" width="40%" height="13px" />
            <Skeleton variant="text" width="80%" height="13px" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
