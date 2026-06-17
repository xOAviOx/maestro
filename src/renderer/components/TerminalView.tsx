import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ipc } from '../ipc'
import type { Workspace } from '@shared/types'

/**
 * A real shell (node-pty) for the workspace's worktree, rendered with xterm.
 * Independent of agent control. The pty lives in the main process and persists
 * across tab/workspace switches; on (re)mount we attach, replay the recent
 * buffer, and stream I/O. We do NOT kill the pty on unmount.
 *
 * Lifecycle care: xterm's FitAddon throws if opened/fit before its container has
 * a layout size, so we defer term.open()/fit() until the ResizeObserver reports
 * a non-zero size, and guard every fit against disposal.
 */
export function TerminalView({ workspace }: { workspace: Workspace }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const wsId = workspace.id
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

    const unsubData = ipc.onTerminalData((e) => {
      if (e.workspaceId === wsId && opened) term.write(e.data)
    })
    const unsubExit = ipc.onTerminalExit((e) => {
      if (e.workspaceId === wsId && opened) {
        term.write(`\r\n\x1b[90m[process exited: ${e.exitCode}]\x1b[0m\r\n`)
      }
    })
    term.onData((data) => ipc.sendTerminalInput(wsId, data))

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
        void ipc.startTerminal(wsId, term.cols, term.rows).then((res) => {
          if (disposed) return
          if (res.buffer) term.write(res.buffer)
          ipc.resizeTerminal(wsId, term.cols, term.rows)
          term.focus()
        })
      } else {
        ipc.resizeTerminal(wsId, term.cols, term.rows)
      }
    }

    const ro = new ResizeObserver(onSized)
    ro.observe(container)

    return () => {
      disposed = true
      ro.disconnect()
      unsubData()
      unsubExit()
      term.dispose()
      // Intentionally NOT disposing the pty — the shell persists in main.
    }
  }, [workspace.id])

  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-[#0b1120] p-1">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
