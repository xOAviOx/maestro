import type { SVGProps } from 'react'

/**
 * Inline-SVG icon set. Every glyph is drawn on a 24×24 viewBox with
 * `stroke="currentColor"` (1.75 stroke) so icons inherit text color and scale
 * with `size`. Replaces the ad-hoc emoji (⚙ ⑃ 🔧 ✕ ↻ …) across the app for a
 * consistent, crisp look on the OLED surfaces.
 */
export type IconName =
  | 'settings'
  | 'fanout'
  | 'plus'
  | 'close'
  | 'refresh'
  | 'play'
  | 'check'
  | 'cross'
  | 'chevronRight'
  | 'chevronDown'
  | 'wrench'
  | 'merge'
  | 'pr'
  | 'archive'
  | 'tests'
  | 'keep'
  | 'terminal'
  | 'diff'
  | 'chat'
  | 'compare'
  | 'folder'
  | 'send'
  | 'queue'
  | 'keyboard'
  | 'spark'
  | 'pause'
  | 'graph'

/** Path/element markup per icon (inside a 24×24 stroke viewBox). */
const PATHS: Record<IconName, JSX.Element> = {
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  fanout: (
    <>
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="5" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M8 11 16 6M8 13l8 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  refresh: <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />,
  play: <path d="M6 4l14 8-14 8z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  cross: <path d="M18 6 6 18M6 6l12 12" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  wrench: (
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.7-.4-.4-2.7z" />
  ),
  merge: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path d="M6 8v8M6 14a8 8 0 0 0 8-5h2" />
    </>
  ),
  pr: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M6 8v8M18 16V9a3 3 0 0 0-3-3h-3m0 0 2.5 2.5M12 6 14.5 3.5" />
    </>
  ),
  archive: (
    <>
      <path d="M3 7h18v3H3zM5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
      <path d="M10 14h4" />
    </>
  ),
  tests: (
    <>
      <path d="M9 3v6l-5 9a2 2 0 0 0 1.8 3h12.4A2 2 0 0 0 20 18l-5-9V3" />
      <path d="M8 3h8M8 13h8" />
    </>
  ),
  keep: <path d="M20 6 9 17l-5-5" />,
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </>
  ),
  diff: (
    <>
      <path d="M12 3v6M9 6h6" />
      <path d="M9 18h6" />
      <rect x="4" y="3" width="16" height="18" rx="2" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" />,
  compare: (
    <>
      <rect x="3" y="5" width="7" height="14" rx="1" />
      <rect x="14" y="5" width="7" height="14" rx="1" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />,
  queue: <path d="M4 6h16M4 12h10M4 18h7M16 15v6M13 18h6" />,
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="12" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M8 6l8 5M8 18l8-5" />
    </>
  )
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
