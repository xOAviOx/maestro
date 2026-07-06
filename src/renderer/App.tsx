import { useEffect } from 'react'
import { useStore } from './store'
import { useShortcuts } from './hooks/useShortcuts'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import { WorkspaceView } from './components/WorkspaceView'
import { WorkflowView } from './components/WorkflowView'
import { NewWorkspaceDialog } from './components/NewWorkspaceDialog'
import { FanOutDialog } from './components/FanOutDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { WorkflowBuilder } from './components/workflow/WorkflowBuilder'
import { ToastViewport } from './components/ui/Toast'

export default function App(): JSX.Element {
  const init = useStore((s) => s.init)
  const view = useStore((s) => s.view)
  const activeDialog = useStore((s) => s.activeDialog)
  const setActiveDialog = useStore((s) => s.setActiveDialog)

  useShortcuts()

  useEffect(() => {
    void init()
  }, [init])

  const closeDialog = (): void => setActiveDialog(null)

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-content">
      <WorkspaceSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {view === 'workflows' ? <WorkflowView /> : <WorkspaceView />}
      </main>

      {activeDialog === 'new' && <NewWorkspaceDialog onClose={closeDialog} />}
      {activeDialog === 'fanout' && <FanOutDialog onClose={closeDialog} />}
      {activeDialog === 'settings' && <SettingsDialog onClose={closeDialog} />}
      {activeDialog === 'shortcuts' && <ShortcutsDialog onClose={closeDialog} />}
      {activeDialog === 'workflow-builder' && <WorkflowBuilder onClose={closeDialog} />}

      <ToastViewport />
    </div>
  )
}
