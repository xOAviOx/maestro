import type { ReactNode } from 'react'

/**
 * Lightweight hover/focus tooltip — no positioning library. Wraps its children
 * in an inline-flex anchor and reveals a small label above on hover/focus via
 * group-hover. Use for icon-only buttons that would otherwise lose their text.
 */
export function Tooltip({
  label,
  children,
  side = 'top'
}: {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
}): JSX.Element {
  const pos =
    side === 'top'
      ? 'bottom-full mb-1.5 left-1/2 -translate-x-1/2'
      : 'top-full mt-1.5 left-1/2 -translate-x-1/2'
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-hair-strong ' +
          'bg-surface-3 px-2 py-1 text-[11px] font-medium text-content shadow-elev ' +
          'opacity-0 transition-opacity duration-150 group-hover/tt:opacity-100 ' +
          'group-focus-within/tt:opacity-100 ' +
          pos
        }
      >
        {label}
      </span>
    </span>
  )
}
