import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ipc } from '../ipc'
import type { AgentType } from '@shared/types'

/**
 * An embedded xterm bound to an agent CLI's interactive login pty (e.g.
 * `claude auth login`, `codex login`). Mirrors TerminalView's lifecycle care
 * (defer open/fit until the container has a layout size), but starts the login
 * command instead of a shell and is keyed by the session key main returns.
 *
 * `onExit` fires when the login process ends so the parent can re-check status.
 */
export function LoginTerminal({
  agentType,
  onExit
}: {
  agentType: AgentType
  onExit: (exitCode: number) => void
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace',
      cursorBlink: true,
      theme: { background: '#0b1120', foreground: '#e2e8f0' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)

    let disposed = false
    let opened = false
    let started = false
    let sessionKey: string | null = null

    const unsubData = ipc.onTerminalData((e) => {
      if (sessionKey && e.workspaceId === sessionKey && opened) term.write(e.data)
    })
    const unsubExit = ipc.onTerminalExit((e) => {
      if (sessionKey && e.workspaceId === sessionKey && opened) {
        term.write(`\r\n\x1b[90m[login finished: ${e.exitCode}]\x1b[0m\r\n`)
        onExitRef.current(e.exitCode)
      }
    })
    term.onData((data) => {
      if (sessionKey) ipc.sendTerminalInput(sessionKey, data)
    })

    const onSized = (): void => {
      if (disposed) return
      if (container.clientWidth === 0 || container.clientHeight === 0) return

      if (!opened) {
        opened = true
        term.open(container)
      }
      try {
        fit.fit()
      } catch {
        return
      }

      if (!started) {
        started = true
        void ipc.startAgentLogin(agentType, term.cols, term.rows).then((res) => {
          if (disposed) return
          if (!res) {
            term.write('\x1b[91mThis agent CLI is not installed.\x1b[0m\r\n')
            return
          }
          sessionKey = res.sessionKey
          ipc.resizeTerminal(sessionKey, term.cols, term.rows)
          term.focus()
        })
      } else if (sessionKey) {
        ipc.resizeTerminal(sessionKey, term.cols, term.rows)
      }
    }

    const ro = new ResizeObserver(onSized)
    ro.observe(container)

    return () => {
      disposed = true
      ro.disconnect()
      unsubData()
      unsubExit()
      // Kill the login pty if it's still running when the pane closes.
      if (sessionKey) void ipc.disposeTerminal(sessionKey)
      term.dispose()
    }
  }, [agentType])

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-md bg-[#0b1120] p-1">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
