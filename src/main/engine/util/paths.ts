import os from 'os'
import path from 'path'

/**
 * Cross-platform path helpers. All worktree/data paths are built here with the
 * `path` module and `os.homedir()` — never hardcoded '/' or '~'.
 */

/** Root for all Maestro local data: <home>/.maestro */
export function maestroHome(): string {
  return path.join(os.homedir(), '.maestro')
}

/** Where isolated worktrees live: <home>/.maestro/workspaces */
export function workspacesRoot(): string {
  return path.join(maestroHome(), 'workspaces')
}

/** Default SQLite database location: <home>/.maestro/maestro.db */
export function defaultDbPath(): string {
  return path.join(maestroHome(), 'maestro.db')
}

/** Resolve a user-supplied path to an absolute, OS-native form. */
export function normalizeRepoPath(p: string): string {
  return path.resolve(p)
}

/**
 * Turn a free-form workspace name into a filesystem- and git-ref-safe slug.
 * Lowercase, ASCII alphanumerics and dashes only, no leading/trailing dashes.
 */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'workspace'
}
