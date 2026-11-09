import { createContext, useContext } from 'react'

export type ToastTone = 'neutral' | 'success' | 'danger'

export interface ToastOptions {
  tone?: ToastTone
  /** Milliseconds before it goes away by itself (default 4000; 0 keeps it until dismissed) */
  duration?: number
}

export interface ToastApi {
  show: (message: string, options?: ToastOptions) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

/** `const toast = useToast(); toast.show(t('expense.saved'))`; needs <ToastProvider> above */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast() needs a <ToastProvider> above it')
  return api
}
