import execa from 'execa'
import fs from 'fs'

/**
 * Cross-platform resolution of a CLI binary on PATH.
 *
 * - Honors an optional env override first (e.g. MAESTRO_CLAUDE_BIN).
 * - On Windows uses `where <cmd>` (the install is typically a `.cmd` shim, with
 *   a native `.exe` sometimes also present); prefers `.exe` (spawns directly),
 *   then `.cmd` (execa/cross-spawn wraps it safely — no shell, so an arbitrary
 *   arg can't be shell-injected), then the bare shim.
 * - On macOS/Linux uses `which <cmd>`.
 *
 * Returns an absolute path, or null if no binary is found.
 */
export async function resolveBinary(
  command: string,
  envOverride?: string
): Promise<string | null> {
  const override = envOverride ? process.env[envOverride] : undefined
  if (override && fs.existsSync(override)) return override

  const isWindows = process.platform === 'win32'
  const finder = isWindows ? 'where' : 'which'
  try {
    const { stdout, exitCode } = await execa(finder, [command], {
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

/**
 * Resolve the Claude Code CLI binary. Honors the MAESTRO_CLAUDE_BIN override.
 *
 * TODO (later, like Conductor): optionally bundle a pinned Claude Code version
 * for version stability instead of relying on the user's PATH install.
 */
export function resolveClaudeBinary(): Promise<string | null> {
  return resolveBinary('claude', 'MAESTRO_CLAUDE_BIN')
}

/** Resolve the Codex CLI binary. Honors the MAESTRO_CODEX_BIN override. */
export function resolveCodexBinary(): Promise<string | null> {
  return resolveBinary('codex', 'MAESTRO_CODEX_BIN')
}
