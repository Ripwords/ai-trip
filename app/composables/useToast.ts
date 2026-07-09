export type ToastType = "info" | "success" | "error"

export interface Toast {
  id: number
  message: string
  type: ToastType
}

// Module-level singleton state (same pattern as useConfirm)
const toasts = ref<Toast[]>([])
let nextId = 0

export function useToast() {
  function dismiss(id: number) {
    const i = toasts.value.findIndex((t) => t.id === id)
    if (i !== -1) toasts.value.splice(i, 1)
  }

  function notify(message: string, type: ToastType = "info", duration = 4000) {
    const id = nextId++
    toasts.value.push({ id, message, type })
    if (import.meta.client && duration > 0) {
      window.setTimeout(() => dismiss(id), duration)
    }
    return id
  }

  return {
    toasts,
    notify,
    dismiss,
    success: (message: string, duration?: number) => notify(message, "success", duration),
    // Errors linger a little longer and are announced assertively by ToastHost
    error: (message: string, duration = 6000) => notify(message, "error", duration),
    info: (message: string, duration?: number) => notify(message, "info", duration),
  }
}
