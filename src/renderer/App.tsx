import { useEffect } from 'react'
import { useStore } from './store'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import { WorkspaceView } from './components/WorkspaceView'

export default function App(): JSX.Element {
  const init = useStore((s) => s.init)
  const error = useStore((s) => s.error)
  const clearError = useStore((s) => s.clearError)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="flex h-full w-full overflow-hidden">
      <WorkspaceSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <WorkspaceView />
      </main>

      {error && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-md border border-red-800 bg-red-950 px-4 py-2 text-sm text-red-200 shadow-lg">
            <span className="max-w-md truncate">{error}</span>
            <button className="text-red-400 hover:text-red-200" onClick={clearError}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
