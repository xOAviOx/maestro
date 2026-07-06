import execa from 'execa'
import path from 'path'
import { GitError } from './errors'
import type { DiffFile, DiffFileStatus, WorkspaceDiff } from '@shared/types'

/**
 * Thin wrapper around the system `git` binary, shelled out via execa.
 *
 * Cross-platform notes:
 *  - execa is called with an args array (no shell), so paths with spaces and
 *    Windows drive letters are passed safely without manual quoting.
 *  - git output is split on /\r?\n/ to tolerate CRLF on Windows.
 *  - the pager is disabled via env so commands never block waiting on a TTY.
 *  - stdout is decoded as UTF-8 (execa default).
 */
interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface ExecaErrInfo {
  exitCode: number | undefined
  stderr: string
  stdout: string
  message: string
}

function readExecaError(err: unknown): ExecaErrInfo {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    return {
      exitCode: typeof e['exitCode'] === 'number' ? (e['exitCode'] as number) : undefined,
      stderr: typeof e['stderr'] === 'string' ? (e['stderr'] as string) : '',
      stdout: typeof e['stdout'] === 'string' ? (e['stdout'] as string) : '',
      message:
        typeof e['shortMessage'] === 'string'
          ? (e['shortMessage'] as string)
          : err instanceof Error
            ? err.message
            : String(err)
    }
  }
  return { exitCode: undefined, stderr: '', stdout: '', message: String(err) }
}

const GIT_ENV = {
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  // Avoid interactive credential/editor prompts hanging a headless run.
  GIT_TERMINAL_PROMPT: '0'
} as const

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.length > 0)
}

export class GitService {
  /** Run a git command in `cwd`. Throws GitError on non-zero unless allowed. */
  private async run(cwd: string, args: string[], allowFailure = false): Promise<RunResult> {
    try {
      const res = await execa('git', args, {
        cwd,
        env: { ...process.env, ...GIT_ENV },
        windowsHide: true,
        stripFinalNewline: false,
        encoding: 'utf8'
      })
      return {
        stdout: String(res.stdout ?? ''),
        stderr: String(res.stderr ?? ''),
        exitCode: res.exitCode ?? 0
      }
    } catch (err) {
      const info = readExecaError(err)
      if (allowFailure) {
        return { stdout: info.stdout, stderr: info.stderr, exitCode: info.exitCode ?? 1 }
      }
      throw new GitError(`git ${args.join(' ')} failed: ${info.message}`, {
        args,
        cwd,
        exitCode: info.exitCode,
        stderr: info.stderr
      })
    }
  }

  /** True if `dir` is inside a git work tree. */
  async isGitRepo(dir: string): Promise<boolean> {
    const res = await this.run(dir, ['rev-parse', '--is-inside-work-tree'], true)
    return res.exitCode === 0 && res.stdout.trim() === 'true'
  }

  /** Absolute, OS-native path to the repo's top-level working directory. */
  async getRepoRoot(dir: string): Promise<string> {
    const res = await this.run(dir, ['rev-parse', '--show-toplevel'])
    // git prints forward slashes on Windows; normalize to OS-native.
    return path.resolve(res.stdout.trim())
  }

  /** Local branch names (short form). */
  async listBranches(repoPath: string): Promise<string[]> {
    const res = await this.run(repoPath, [
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads'
    ])
    return splitLines(res.stdout)
  }

  /** Current branch name, or null if HEAD is detached. */
  async getCurrentBranch(repoPath: string): Promise<string | null> {
    const res = await this.run(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], true)
    const name = res.stdout.trim()
    if (res.exitCode !== 0 || name === '' || name === 'HEAD') return null
    return name
  }

  async branchExists(repoPath: string, branch: string): Promise<boolean> {
    const res = await this.run(
      repoPath,
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      true
    )
    return res.exitCode === 0
  }

  /**
   * Best-effort detection of the repo's default base branch:
   * origin/HEAD → local main → local master → current branch.
   */
  async getDefaultBaseBranch(repoPath: string): Promise<string> {
    const originHead = await this.run(
      repoPath,
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      true
    )
    if (originHead.exitCode === 0) {
      const ref = originHead.stdout.trim() // e.g. "origin/main"
      const stripped = ref.replace(/^origin\//, '')
      if (stripped) return stripped
    }
    if (await this.branchExists(repoPath, 'main')) return 'main'
    if (await this.branchExists(repoPath, 'master')) return 'master'
    const current = await this.getCurrentBranch(repoPath)
    return current ?? 'main'
  }

  // --- Worktrees -----------------------------------------------------------

  /** `git worktree add <worktreePath> -b <branch> <baseBranch>` */
  async addWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    baseBranch: string
  ): Promise<void> {
    await this.run(repoPath, ['worktree', 'add', worktreePath, '-b', branch, baseBranch])
  }

  /** Parsed entries from `git worktree list --porcelain`. */
  async listWorktrees(
    repoPath: string
  ): Promise<Array<{ path: string; branch: string | null; head: string | null }>> {
    const res = await this.run(repoPath, ['worktree', 'list', '--porcelain'])
    const out: Array<{ path: string; branch: string | null; head: string | null }> = []
    let current: { path: string; branch: string | null; head: string | null } | null = null
    for (const line of splitLines(res.stdout)) {
      if (line.startsWith('worktree ')) {
        if (current) out.push(current)
        current = { path: path.resolve(line.slice('worktree '.length)), branch: null, head: null }
      } else if (line.startsWith('HEAD ') && current) {
        current.head = line.slice('HEAD '.length).trim()
      } else if (line.startsWith('branch ') && current) {
        // e.g. "branch refs/heads/maestro/foo"
        current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '').trim()
      }
    }
    if (current) out.push(current)
    return out
  }

  /** `git worktree remove [--force] <path>` */
  async removeWorktree(repoPath: string, worktreePath: string, force = false): Promise<void> {
    const args = ['worktree', 'remove']
    if (force) args.push('--force')
    args.push(worktreePath)
    await this.run(repoPath, args)
  }

  async pruneWorktrees(repoPath: string): Promise<void> {
    await this.run(repoPath, ['worktree', 'prune'])
  }

  // --- Merge / review ------------------------------------------------------

  /** Path of the worktree where `branch` is currently checked out, or null. */
  async findWorktreeForBranch(repoPath: string, branch: string): Promise<string | null> {
    const worktrees = await this.listWorktrees(repoPath)
    return worktrees.find((w) => w.branch === branch)?.path ?? null
  }

  /** Number of commits on `branch` not reachable from `base`. */
  async commitCountBetween(cwd: string, base: string, branch: string): Promise<number> {
    const res = await this.run(cwd, ['rev-list', '--count', `${base}..${branch}`], true)
    const n = parseInt(res.stdout.trim(), 10)
    return Number.isFinite(n) ? n : 0
  }

  /** Files left in a conflicted (unmerged) state. */
  async listConflictedFiles(cwd: string): Promise<string[]> {
    const res = await this.run(cwd, ['diff', '--name-only', '--diff-filter=U'], true)
    return splitLines(res.stdout)
  }

  /**
   * Merge `branch` into the branch checked out at `baseWorktree`. On conflict,
   * the merge is ABORTED (leaving the base worktree clean) and the conflicted
   * files are returned — we never leave a half-merged state.
   */
  async merge(
    baseWorktree: string,
    branch: string,
    message: string
  ): Promise<{ ok: boolean; conflicted: string[] }> {
    const res = await this.run(baseWorktree, ['merge', '--no-ff', '-m', message, branch], true)
    if (res.exitCode === 0) return { ok: true, conflicted: [] }
    const conflicted = await this.listConflictedFiles(baseWorktree)
    await this.run(baseWorktree, ['merge', '--abort'], true)
    return { ok: false, conflicted }
  }

  /**
   * Rebase the worktree's branch onto `baseBranch`. Mirrors merge()'s contract:
   * on conflict the rebase is ABORTED (leaving the worktree exactly as it was)
   * and the conflicted files are returned — we never leave a rebase in progress.
   * Requires a clean worktree (commit first).
   */
  async rebase(
    worktreePath: string,
    baseBranch: string
  ): Promise<{ ok: boolean; conflicted: string[] }> {
    const res = await this.run(worktreePath, ['rebase', baseBranch], true)
    if (res.exitCode === 0) return { ok: true, conflicted: [] }
    const conflicted = await this.listConflictedFiles(worktreePath)
    await this.run(worktreePath, ['rebase', '--abort'], true)
    return { ok: false, conflicted }
  }

  /** Resolve a ref (branch, HEAD, sha) to its full commit sha. */
  async revParse(cwd: string, ref: string): Promise<string> {
    return (await this.run(cwd, ['rev-parse', ref])).stdout.trim()
  }

  async listRemotes(cwd: string): Promise<string[]> {
    const res = await this.run(cwd, ['remote'], true)
    return splitLines(res.stdout)
  }

  /** Push `branch` to `remote`, setting upstream. */
  async push(cwd: string, remote: string, branch: string): Promise<void> {
    await this.run(cwd, ['push', '-u', remote, branch])
  }

  // --- Status / diff -------------------------------------------------------

  /** True if the worktree has staged or unstaged changes (ignores untracked). */
  async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    const res = await this.run(worktreePath, ['status', '--porcelain'])
    return splitLines(res.stdout).some((l) => !l.startsWith('?? '))
  }

  /** Stage everything and commit. Returns true if a commit was made. */
  async commitAll(worktreePath: string, message: string): Promise<boolean> {
    await this.run(worktreePath, ['add', '-A'])
    const res = await this.run(worktreePath, ['commit', '-m', message], true)
    if (res.exitCode === 0) return true
    // "nothing to commit" is not an error for our purposes.
    if (/nothing to commit/i.test(res.stdout + res.stderr)) return false
    throw new GitError(`git commit failed: ${res.stderr || res.stdout}`, {
      worktreePath,
      exitCode: res.exitCode
    })
  }

  /** The merge-base commit between a base branch and the worktree's HEAD. */
  async getMergeBase(worktreePath: string, baseBranch: string): Promise<string> {
    return (await this.run(worktreePath, ['merge-base', baseBranch, 'HEAD'])).stdout.trim()
  }

  /** Contents of `relPath` at `ref` (e.g. a merge-base commit), or null if absent. */
  async getFileAtRef(worktreePath: string, ref: string, relPath: string): Promise<string | null> {
    const res = await this.run(worktreePath, ['show', `${ref}:${relPath}`], true)
    if (res.exitCode !== 0) return null
    return res.stdout
  }

  /**
   * Diff of the worktree against its base branch: all changes since the branch
   * point (committed + uncommitted), plus a list of untracked files.
   */
  async getDiff(worktreePath: string, baseBranch: string): Promise<WorkspaceDiff> {
    const mergeBase = await this.getMergeBase(worktreePath, baseBranch)

    const nameStatus = (
      await this.run(worktreePath, ['diff', '--name-status', '-M', mergeBase])
    ).stdout
    const files = parseNameStatus(nameStatus)

    const patch = (await this.run(worktreePath, ['diff', '-M', mergeBase])).stdout

    const untracked = splitLines(
      (await this.run(worktreePath, ['ls-files', '--others', '--exclude-standard'])).stdout
    )
    for (const u of untracked) {
      files.push({ path: u, status: 'untracked' })
    }

    return { baseBranch, mergeBase, files, patch, untracked }
  }
}

function mapStatusCode(code: string): DiffFileStatus {
  switch (code.charAt(0)) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'type-changed'
    default:
      return 'modified'
  }
}

/** Parse `git diff --name-status -M` output into DiffFile entries. */
function parseNameStatus(text: string): DiffFile[] {
  const files: DiffFile[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue
    const parts = line.split('\t')
    const code = parts[0] ?? ''
    const status = mapStatusCode(code)
    if ((status === 'renamed' || status === 'copied') && parts.length >= 3) {
      const oldPath = parts[1] ?? ''
      const newPath = parts[2] ?? ''
      files.push({ path: newPath, status, oldPath })
    } else {
      const filePath = parts[1] ?? ''
      if (filePath) files.push({ path: filePath, status })
    }
  }
  return files
}
