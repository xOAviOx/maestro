import { useState } from 'react'
import { useAppStore } from './store'

/**
 * Module 0 placeholder UI. Proves the secure IPC bridge works end to end:
 * the renderer sends a string to main and renders main's validated reply.
 * Replaced by the real workspace shell in Module 4.
 */
export default function App(): JSX.Element {
  const [message, setMessage] = useState('hello from renderer')
  const { ping, pinging, lastReply, lastError } = useAppStore()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Maestro</h1>
        <p className="mt-1 text-sm text-slate-400">
          Parallel coding-agent orchestrator — Module 0 scaffold
        </p>
      </div>

      <div className="flex w-full max-w-xl items-center gap-2">
        <input
          className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-slate-500"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="message to round-trip through main"
        />
        <button
          className="rounded-md bg-status-running px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void ping(message)}
          disabled={pinging}
        >
          {pinging ? 'Pinging…' : 'Ping main'}
        </button>
      </div>

      <div className="h-10 text-center text-sm">
        {lastReply && <span className="text-status-done">{lastReply}</span>}
        {lastError && <span className="text-status-error">Error: {lastError}</span>}
      </div>
    </div>
  )
}
