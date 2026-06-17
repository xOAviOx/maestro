import * as pty from 'node-pty'
import { log } from '../log'
import type { TerminalDataEvent, TerminalExitEvent } from '@shared/types'

/** Cap of recent output replayed when a renderer re-attaches to a session. */
const MAX_BUFFER_BYTES = 64 * 1024

interface Session {
  proc: pty.IPty
  buffer: string
}

/**
 * Owns one real shell (node-pty) per workspace, keyed by workspace id. Lives in
 * the main process only (the renderer never touches node-pty). Output is pushed
 * to the renderer via the provided sinks; a small ring buffer of recent output
 * is kept so re-opening the Terminal tab replays the last screenful.
 *
 * The shell persists across renderer remounts (tab/workspace switches) — it is
 * only killed on dispose() or app quit.
 */
export class PtyManager {
  private readonly sessions = new Map<string, Session>()
  private readonly onData: (e: TerminalDataEvent) => void
  private readonly onExit: (e: TerminalExitEvent) => void

  constructor(onData: (e: TerminalDataEvent) => void, onExit: (e: TerminalExitEvent) => void) {
    this.onData = onData
    this.onExit = onExit
  }

  /** Start a shell for the workspace (or re-attach if one exists). Returns the
   * recent-output replay buffer. */
  start(workspaceId: string, worktreePath: string, cols: number, rows: number): string {
    const shell = defaultShell()
    return this.spawn(workspaceId, shell.file, shell.args, worktreePath, cols, rows)
  }

  /**
   * Start an explicit command in a pty under an arbitrary key (re-attaching if a
   * session for that key is already running). Used for agent CLI login flows,
   * which must run as a real interactive process — not the default shell — so the
   * user can complete the CLI's own OAuth handshake. Output streams over the same
   * data/exit sinks, tagged with `key`.
   */
  startCommand(
    key: string,
    file: string,
    args: string[],
    cwd: string,
    cols: number,
    rows: number
  ): string {
    return this.spawn(key, file, args, cwd, cols, rows)
  }

  private spawn(
    key: string,
    file: string,
    args: string[],
    cwd: string,
    cols: number,
    rows: number
  ): string {
    const existing = this.sessions.get(key)
    if (existing) {
      this.safeResize(existing.proc, cols, rows)
      return existing.buffer
    }

    const proc = pty.spawn(file, args, {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>
    })

    const session: Session = { proc, buffer: '' }
    this.sessions.set(key, session)

    proc.onData((data) => {
      session.buffer = (session.buffer + data).slice(-MAX_BUFFER_BYTES)
      this.onData({ workspaceId: key, data })
    })
    proc.onExit(({ exitCode }) => {
      this.sessions.delete(key)
      this.onExit({ workspaceId: key, exitCode })
    })

    log.info('terminal.started', { key, file })
    return ''
  }

  write(workspaceId: string, data: string): void {
    this.sessions.get(workspaceId)?.proc.write(data)
  }

  resize(workspaceId: string, cols: number, rows: number): void {
    const session = this.sessions.get(workspaceId)
    if (session) this.safeResize(session.proc, cols, rows)
  }

  dispose(workspaceId: string): void {
    const session = this.sessions.get(workspaceId)
    if (!session) return
    try {
      session.proc.kill()
    } catch {
      // already gone
    }
    this.sessions.delete(workspaceId)
    log.info('terminal.disposed', { workspaceId })
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.dispose(id)
  }

  private safeResize(proc: pty.IPty, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) {
      try {
        proc.resize(cols, rows)
      } catch {
        // pty may have exited between events
      }
    }
  }
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    // PowerShell is available on all supported Windows; node-pty uses ConPTY.
    return { file: 'powershell.exe', args: [] }
  }
  return { file: process.env['SHELL'] ?? '/bin/bash', args: [] }
}
