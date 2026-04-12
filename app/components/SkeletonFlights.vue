<template>
  <div class="space-y-4">
    <!-- Add flight form skeleton -->
    <div class="rounded-2xl border border-sand-200 bg-white p-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div class="flex-1 space-y-1">
          <Skeleton variant="text" width="80px" height="12px" />
          <Skeleton variant="block" height="40px" rounded="12px" />
        </div>
        <div class="flex-1 space-y-1">
          <Skeleton variant="text" width="40px" height="12px" />
          <Skeleton variant="block" height="40px" rounded="12px" />
        </div>
        <Skeleton variant="block" width="110px" height="40px" rounded="12px" />
      </div>
    </div>

    <!-- Flight card skeletons -->
    <div v-for="i in 3" :key="i" class="rounded-2xl border border-sand-200 bg-white p-5">
      <div class="flex items-start justify-between">
        <div class="flex items-center gap-3">
          <Skeleton variant="circle" width="32px" height="32px" rounded="10px" />
          <div class="space-y-1">
            <Skeleton variant="text" width="60px" height="12px" />
            <Skeleton variant="text" width="70px" height="18px" />
          </div>
        </div>
        <Skeleton variant="block" width="80px" height="24px" rounded="20px" />
      </div>
      <div class="mt-4 flex items-center gap-3">
        <div class="text-center">
          <Skeleton variant="text" width="40px" height="20px" />
          <Skeleton variant="text" width="36px" height="12px" class="mt-1" />
        </div>
        <Skeleton variant="text" height="1px" class="flex-1" />
        <div class="text-center">
          <Skeleton variant="text" width="40px" height="20px" />
          <Skeleton variant="text" width="36px" height="12px" class="mt-1" />
        </div>
      </div>
      <div class="mt-3 flex gap-2">
        <Skeleton variant="text" width="90px" height="13px" />
        <Skeleton variant="block" width="100px" height="22px" rounded="8px" />
      </div>
    </div>
  </div>
</template>
