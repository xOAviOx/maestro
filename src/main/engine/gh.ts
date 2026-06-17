import execa from 'execa'
import { GhUnavailableError } from './errors'

/**
 * Thin wrapper around the GitHub CLI (`gh`), used only for optional PR creation.
 * Everything here degrades gracefully: if `gh` is missing or unauthenticated,
 * isGhAvailable() returns false and the UI hides/disables the PR action.
 */
export async function isGhAvailable(): Promise<boolean> {
  try {
    const version = await execa('gh', ['--version'], { reject: false, windowsHide: true })
    if (version.exitCode !== 0) return false
    const auth = await execa('gh', ['auth', 'status'], { reject: false, windowsHide: true })
    return auth.exitCode === 0
  } catch {
    return false
  }
}

export interface CreatePrOptions {
  base: string
  head: string
  title: string
  body: string
}

/** Create a PR via `gh pr create`; returns the PR URL printed on stdout. */
export async function createPr(cwd: string, opts: CreatePrOptions): Promise<string> {
  const res = await execa(
    'gh',
    ['pr', 'create', '--base', opts.base, '--head', opts.head, '--title', opts.title, '--body', opts.body],
    { cwd, reject: false, windowsHide: true, encoding: 'utf8' }
  )
  if (res.exitCode !== 0) {
    throw new GhUnavailableError(`gh pr create failed: ${String(res.stderr) || String(res.stdout)}`)
  }
  const lines = String(res.stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('http'))
  return lines.pop() ?? String(res.stdout).trim()
}
