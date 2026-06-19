import { useEffect } from 'react'
import { useStore, type Toast as ToastData } from '../../store'
import { cn } from './cn'
import { IconButton } from './IconButton'
import { Icon, type IconName } from './Icon'

const KIND_META: Record<ToastData['kind'], { icon: IconName; accent: string; ring: string }> = {
  success: { icon: 'check', accent: 'text-status-done', ring: 'border-status-done/40' },
  error: { icon: 'cross', accent: 'text-status-error', ring: 'border-status-error/40' },
  info: { icon: 'spark', accent: 'text-accent', ring: 'border-accent/40' }
}

/** Bottom-right stack of dismissible toasts, fed by the store's toast queue. */
export function ToastViewport(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastCard({ toast }: { toast: ToastData }): JSX.Element {
  const dismiss = useStore((s) => s.dismissToast)
  const meta = KIND_META[toast.kind]

  useEffect(() => {
    const ms = toast.kind === 'error' ? 7000 : 4000
    const t = setTimeout(() => dismiss(toast.id), ms)
    return () => clearTimeout(t)
  }, [toast.id, toast.kind, dismiss])

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-surface-2/95 px-3.5 py-3 shadow-elev glass animate-toast-in',
        meta.ring
      )}
    >
      <span className={cn('mt-0.5 shrink-0', meta.accent)}>
        <Icon name={meta.icon} size={18} />
      </span>
      <p className="min-w-0 flex-1 break-words text-sm text-content">{toast.message}</p>
      <IconButton
        className="-mr-1 -mt-1 h-6 w-6"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss"
      >
        <Icon name="close" size={14} />
      </IconButton>
    </div>
  )
}
