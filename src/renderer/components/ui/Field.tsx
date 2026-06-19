import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from 'react'
import { cn } from './cn'

/** Shared field appearance for inputs/selects/textareas. */
export const FIELD =
  'no-drag w-full rounded-lg border border-hair-strong bg-surface px-3 py-2 text-sm text-content ' +
  'placeholder:text-content-faint outline-none transition-colors ' +
  'focus:border-accent/60 focus:ring-2 focus:ring-accent/25 ' +
  'disabled:opacity-50'

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input className={cn(FIELD, className)} {...rest} />
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea className={cn(FIELD, 'resize-none', className)} {...rest} />
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <select className={cn(FIELD, 'cursor-pointer', className)} {...rest}>
      {children}
    </select>
  )
}

/** Small uppercase field label. */
export function FieldLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-content-faint">
      {children}
    </label>
  )
}
