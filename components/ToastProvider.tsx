'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

type ToastVariant = 'success' | 'error' | 'info'

interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

interface ToastRecord extends ToastInput {
  id: string
  variant: ToastVariant
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

function getVariantLabel(variant: ToastVariant) {
  switch (variant) {
    case 'success':
      return 'Saved'
    case 'error':
      return 'Error'
    default:
      return 'Notice'
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const timeoutMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismissToast = useCallback((toastId: string) => {
    const timeout = timeoutMap.current.get(toastId)
    if (timeout) {
      clearTimeout(timeout)
      timeoutMap.current.delete(toastId)
    }

    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId))
  }, [])

  const showToast = useCallback(
    ({ title, description, variant = 'info', duration = 3200 }: ToastInput) => {
      const toastId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`

      setToasts((currentToasts) => [
        ...currentToasts,
        {
          id: toastId,
          title,
          description,
          variant,
        },
      ])

      const timeout = setTimeout(() => dismissToast(toastId), duration)
      timeoutMap.current.set(toastId, timeout)
    },
    [dismissToast]
  )

  useEffect(() => {
    return () => {
      timeoutMap.current.forEach((timeout) => clearTimeout(timeout))
      timeoutMap.current.clear()
    }
  }, [])

  const contextValue = useMemo(
    () => ({
      showToast,
    }),
    [showToast]
  )

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 top-4 z-[120] flex flex-col gap-3 sm:left-auto sm:right-6 sm:top-6 sm:w-[24rem]">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto animate-site-toast-in border border-black border-l-4 border-l-clay-600 bg-white px-4 py-3 shadow-[8px_8px_0_rgba(31,29,26,0.08)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-gray-500">
                  {getVariantLabel(toast.variant)}
                </p>
                <p className="mt-1 font-mono text-sm font-bold">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-2 font-mono text-xs leading-5 text-gray-600">
                    {toast.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="border border-black px-2 py-1 font-mono text-[0.65rem] uppercase tracking-[0.22em] hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }

  return context
}
