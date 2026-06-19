import { useEffect } from 'react'
import { useStore } from '../store'

/**
 * Global keyboard shortcuts. Mounted once in App. Uses the store's lifted UI
 * state (activeDialog, activeTab, selectedWorkspaceId) so it can drive dialogs
 * and tabs that live in child components.
 *
 *   ⌘/Ctrl + N        New workspace
 *   ⌘/Ctrl + ⇧ + N    Fan out
 *   ⌘/Ctrl + ,        Settings
 *   ⌘/Ctrl + 1..4     Chat / Diff / Terminal / Compare
 *   ⌘/Ctrl + Enter    Run tests for the selected workspace
 *   ?                 Shortcut cheat-sheet (when not typing in a field)
 *
 * Esc-to-close for modals is handled inside the Modal component itself.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      const mod = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      // "?" cheat-sheet — only when not typing and no modifier.
      if (!mod && !typing && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault()
        s.setActiveDialog(s.activeDialog === 'shortcuts' ? null : 'shortcuts')
        return
      }

      if (!mod) return

      // Dialog openers (work regardless of focus).
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (!s.activeRepoPath) return
        s.setActiveDialog(e.shiftKey ? 'fanout' : 'new')
        return
      }
      if (e.key === ',') {
        e.preventDefault()
        s.setActiveDialog('settings')
        return
      }

      // The rest target the selected workspace; skip while typing or while a
      // dialog is open (the dialog owns the foreground; don't act behind it).
      if (typing || s.activeDialog) return

      if (e.key >= '1' && e.key <= '4') {
        if (!s.selectedWorkspaceId) return
        e.preventDefault()
        const tabs = ['chat', 'diff', 'terminal', 'compare'] as const
        s.setActiveTab(tabs[Number(e.key) - 1]!)
        return
      }

      if (e.key === 'Enter') {
        const id = s.selectedWorkspaceId
        if (!id || s.testRunning[id]) return
        // Mirror the Run-tests button's guard: no command → no-op (avoids a
        // spurious error toast from TestCommandNotConfiguredError).
        const configured = (s.repoInfo?.testCommand ?? '').trim().length > 0
        if (!configured) return
        e.preventDefault()
        void s.runTests(id)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
