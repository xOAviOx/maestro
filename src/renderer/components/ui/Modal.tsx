import { useEffect, type ReactNode } from 'react'
import { cn } from './cn'
import { IconButton } from './IconButton'
import { Icon } from './Icon'

/**
 * Shared modal shell: centered glass card over a dimmed backdrop, with the
 * slide-up entrance from the design system. Closes on Esc and on backdrop click
 * (clicks inside the card are ignored). Used by every dialog so they share one
 * appearance and one dismissal behavior.
 */
export function Modal({
  onClose,
  children,
  title,
  size = 'md',
  className
}: {
  onClose: () => void
  children: ReactNode
  title?: ReactNode
  size?: 'md' | 'lg' | 'xl'
  className?: string
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const width = size === 'xl' ? 'max-w-xl' : size === 'lg' ? 'max-w-lg' : 'max-w-md'

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4 animate-fade-in backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex max-h-[85vh] w-full flex-col rounded-2xl border border-hair-strong bg-surface p-5 shadow-elev animate-slide-up',
          width,
          className
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-content">{title}</h2>
            <IconButton onClick={onClose} aria-label="Close" title="Close (Esc)">
              <Icon name="close" />
            </IconButton>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
