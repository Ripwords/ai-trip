interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

const isOpen = ref(false)
const options = ref<ConfirmOptions>({
  title: "",
  message: "",
})
let resolvePromise: ((value: boolean) => void) | null = null

export function useConfirm() {
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    options.value = opts
    isOpen.value = true
    return new Promise<boolean>((resolve) => {
      resolvePromise = resolve
    })
  }

  function handleConfirm() {
    isOpen.value = false
    resolvePromise?.(true)
    resolvePromise = null
  }

  function handleCancel() {
    isOpen.value = false
    resolvePromise?.(false)
    resolvePromise = null
  }

  return {
    isOpen,
    options,
    confirm,
    handleConfirm,
    handleCancel,
  }
}
