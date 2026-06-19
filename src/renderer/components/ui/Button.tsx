import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md'

const BASE =
  'no-drag inline-flex items-center justify-center gap-1.5 rounded-lg font-medium ' +
  'transition-all duration-150 outline-none select-none ' +
  'focus-visible:ring-2 focus-visible:ring-accent/50 ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-bg shadow-[0_0_18px_-4px_rgba(34,211,238,0.55)] hover:bg-accent-strong hover:shadow-[0_0_22px_-2px_rgba(34,211,238,0.7)]',
  secondary:
    'border border-hair-strong bg-surface-2 text-content hover:bg-surface-3 hover:border-hair-strong',
  ghost: 'text-content-muted hover:bg-surface-2 hover:text-content',
  danger:
    'border border-status-error/50 text-status-error hover:bg-status-error/10 hover:border-status-error',
  success:
    'bg-status-done/90 text-white hover:bg-status-done shadow-[0_0_18px_-6px_rgba(34,197,94,0.6)]'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-2 text-sm'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonProps): JSX.Element {
  return <button className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...rest} />
}
