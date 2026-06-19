import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

/** Small square icon-only button for ✕ / ↻ / ▾ affordances. */
export function IconButton({
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      className={cn(
        'no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-content-faint',
        'transition-colors hover:bg-surface-3 hover:text-content',
        'outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        'active:scale-95 disabled:pointer-events-none disabled:opacity-40',
        className
      )}
      {...rest}
    />
  )
}
