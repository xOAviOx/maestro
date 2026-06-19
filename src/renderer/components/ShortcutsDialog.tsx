import { Modal } from './ui/Modal'

const MOD = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [MOD, 'N'], label: 'New workspace' },
  { keys: [MOD, '⇧', 'N'], label: 'Fan out a task' },
  { keys: [MOD, ','], label: 'Settings & accounts' },
  { keys: [MOD, '1'], label: 'Chat tab' },
  { keys: [MOD, '2'], label: 'Diff tab' },
  { keys: [MOD, '3'], label: 'Terminal tab' },
  { keys: [MOD, '4'], label: 'Compare tab' },
  { keys: [MOD, '↵'], label: 'Run tests' },
  { keys: ['↵'], label: 'Send prompt (in composer)' },
  { keys: ['⇧', '↵'], label: 'New line (in composer)' },
  { keys: ['Esc'], label: 'Close dialog' },
  { keys: ['?'], label: 'This cheat-sheet' }
]

/** Keyboard-shortcut reference, opened from the sidebar or via "?". */
export function ShortcutsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Modal onClose={onClose} title="Keyboard shortcuts" size="md">
      <ul className="flex flex-col divide-y divide-hair">
        {SHORTCUTS.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4 py-2">
            <span className="text-sm text-content-muted">{s.label}</span>
            <span className="flex shrink-0 gap-1">
              {s.keys.map((k, i) => (
                <kbd
                  key={i}
                  className="min-w-[1.5rem] rounded-md border border-hair-strong bg-surface-2 px-1.5 py-0.5 text-center font-mono text-xs text-content"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
