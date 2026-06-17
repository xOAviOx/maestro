import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ipc } from '../ipc'
import type { AgentType } from '@shared/types'

/**
 * An embedded xterm bound to an agent CLI's interactive login pty (e.g.
 * `claude auth login`, `codex login`), keyed by the session key main returns.
 *
 * Notes / gotchas handled here:
 *  - We open the terminal and fit AFTER a frame (requestAnimationFrame) and guard
 *    every fit() — calling it before the element is laid out throws inside xterm
 *    ("Cannot read properties of undefined (reading 'dimensions')").
 *  - The CLI prints an OAuth URL to finish sign-in. xterm's own link handling
 *    tries window.open, which Electron blocks. So we scan the streamed output for
 *    the first https URL and open it via the main process (shell.openExternal),
 *    and also echo a "click here / copy this" line.
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
    let sessionKey: string | null = null
    let opened = false
    let openedUrl = false

    const safeFit = (): void => {
      if (disposed || !opened) return
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      try {
        fit.fit()
      } catch {
        // term not ready / mid-teardown — ignore
      }
    }

    // Detect the first OAuth URL the CLI prints and open it in the real browser.
    const urlRe = /https?:\/\/[^\s"']+/
    const maybeOpenLoginUrl = (chunk: string): void => {
      if (openedUrl) return
      const m = chunk.match(urlRe)
      if (!m) return
      openedUrl = true
      const url = m[0].replace(/[)\].,]+$/, '')
      term.write(`\r\n\x1b[96mOpening sign-in page in your browser:\x1b[0m\r\n${url}\r\n`)
      void ipc.openExternal(url).catch(() => {
        term.write('\r\n\x1b[91mCouldn’t open the browser automatically — copy the URL above.\x1b[0m\r\n')
      })
    }

    const unsubData = ipc.onTerminalData((e) => {
      if (sessionKey && e.workspaceId === sessionKey) {
        term.write(e.data)
        maybeOpenLoginUrl(e.data)
      }
    })
    const unsubExit = ipc.onTerminalExit((e) => {
      if (sessionKey && e.workspaceId === sessionKey) {
        term.write(`\r\n\x1b[90m[login finished: ${e.exitCode}]\x1b[0m\r\n`)
        onExitRef.current(e.exitCode)
      }
    })
    term.onData((data) => {
      if (sessionKey) ipc.sendTerminalInput(sessionKey, data)
    })

    const ro = new ResizeObserver(() => {
      safeFit()
      if (sessionKey) ipc.resizeTerminal(sessionKey, term.cols, term.rows)
    })

    // Defer open+fit+start to the next frame so the modal has laid out.
    const raf = requestAnimationFrame(() => {
      if (disposed) return
      term.open(container)
      opened = true
      safeFit()
      ro.observe(container)

      const cols = term.cols > 0 ? term.cols : 80
      const rows = term.rows > 0 ? term.rows : 24
      term.write(`\x1b[90mStarting ${agentType} login…\x1b[0m\r\n`)
      ipc
        .startAgentLogin(agentType, cols, rows)
        .then((res) => {
          if (disposed) return
          if (!res) {
            term.write('\x1b[91mThis agent CLI is not installed or has no login flow.\x1b[0m\r\n')
            return
          }
          sessionKey = res.sessionKey
          ipc.resizeTerminal(sessionKey, cols, rows)
          term.focus()
        })
        .catch((err: unknown) => {
          if (disposed) return
          const msg = err instanceof Error ? err.message : String(err)
          term.write(`\x1b[91mFailed to start login: ${msg}\x1b[0m\r\n`)
        })
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
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
