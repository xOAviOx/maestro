import fs from 'fs'
import path from 'path'

/**
 * Minimal, dependency-free glob matching for the per-repo "files to copy"
 * feature. Supports the subset needed for patterns like ".env.local",
 * ".env*", "config/*.local.json", "**\/*.pem":
 *   **  matches across directory separators
 *   *   matches within a single path segment
 *   ?   matches a single non-separator char
 *
 * We intentionally avoid pulling in a glob dependency (not in the approved
 * stack). Patterns are matched against repo-relative POSIX-style paths.
 */
function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/')
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g.charAt(i)
    if (c === '*') {
      if (g.charAt(i + 1) === '*') {
        re += '.*'
        i++
        if (g.charAt(i + 1) === '/') i++ // consume trailing slash of **/
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp('^' + re + '$')
}

const IGNORED_DIRS = new Set(['.git', 'node_modules'])
const MAX_FILES_SCANNED = 50_000

/** Recursively collect repo-relative (POSIX) file paths, skipping heavy dirs. */
function collectFiles(root: string): string[] {
  const out: string[] = []
  const walk = (relDir: string, depth: number): void => {
    if (depth > 24 || out.length >= MAX_FILES_SCANNED) return
    const absDir = relDir ? path.join(root, relDir) : root
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES_SCANNED) return
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(childRel, depth + 1)
      } else if (entry.isFile()) {
        out.push(childRel)
      }
    }
  }
  walk('', 0)
  return out
}

/**
 * Copy every file under `repoRoot` matching any of `patterns` into
 * `worktreePath`, preserving relative layout and creating parent dirs.
 * Returns the list of repo-relative paths copied. Missing/unmatched → no-op.
 */
export function copyMatchingFiles(
  repoRoot: string,
  worktreePath: string,
  patterns: string[]
): string[] {
  if (patterns.length === 0) return []
  const regexes = patterns.map(globToRegExp)
  const files = collectFiles(repoRoot)
  const copied: string[] = []
  for (const rel of files) {
    if (!regexes.some((re) => re.test(rel))) continue
    const src = path.join(repoRoot, ...rel.split('/'))
    const dest = path.join(worktreePath, ...rel.split('/'))
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
      copied.push(rel)
    } catch {
      // Best-effort: a file we can't copy shouldn't fail workspace creation.
    }
  }
  return copied
}
