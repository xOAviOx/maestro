import execa from 'execa'
import fs from 'fs'

/**
 * Cross-platform resolution of the Claude Code CLI binary.
 *
 * - Honors the MAESTRO_CLAUDE_BIN override first.
 * - On Windows uses `where claude` (the shim is typically `claude.cmd`, with a
 *   native `claude.exe` sometimes also present); prefers `.exe` (spawns
 *   directly), then `.cmd` (execa/cross-spawn wraps it safely — no shell, so an
 *   arbitrary prompt arg can't be shell-injected), then the bare shim.
 * - On macOS/Linux uses `which claude`.
 *
 * Returns an absolute path, or null if no binary is found.
 *
 * TODO (later, like Conductor): optionally bundle a pinned Claude Code version
 * for version stability instead of relying on the user's PATH install.
 */
export async function resolveClaudeBinary(): Promise<string | null> {
  const override = process.env['MAESTRO_CLAUDE_BIN']
  if (override && fs.existsSync(override)) return override

  const isWindows = process.platform === 'win32'
  const finder = isWindows ? 'where' : 'which'
  try {
    const { stdout, exitCode } = await execa(finder, ['claude'], {
      reject: false,
      windowsHide: true,
      encoding: 'utf8'
    })
    if (exitCode !== 0) return null
    const candidates = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && fs.existsSync(l))
    if (candidates.length === 0) return null

    if (isWindows) {
      const byExt = (ext: string): string | undefined =>
        candidates.find((c) => c.toLowerCase().endsWith(ext))
      return byExt('.exe') ?? byExt('.cmd') ?? byExt('.bat') ?? candidates[0] ?? null
    }
    return candidates[0] ?? null
  } catch {
    return null
  }
}
