import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { GitService } from './GitService'
import { RepoStore } from './store/RepoStore'
import { WorkspaceStore } from './store/WorkspaceStore'
import {
  NotAGitRepoError,
  RepoNotFoundError,
  WorkspaceDirtyError,
  WorkspaceNotFoundError
} from './errors'
import { normalizeRepoPath, slugify, workspacesRoot } from './util/paths'
import { copyMatchingFiles } from './util/glob'
import { withLock } from './util/locks'
import { log } from '../log'
import {
  CreateWorkspaceInputSchema,
  type CreateWorkspaceInput,
  type RepoInfo,
  type Workspace,
  type WorkspaceDiff
} from '@shared/types'

/**
 * Creates/lists/removes worktrees and their backing Workspace records.
 *
 * Enforces the core isolation rule: one workspace owns one branch, and a branch
 * is never checked out in two worktrees. Branch + worktree-dir names are
 * uniquified per repo before `git worktree add`. All mutating git ops are
 * serialized per repo via withLock(repoRoot).
 */
export class WorktreeManager {
  private readonly git: GitService
  private readonly repos: RepoStore
  private readonly workspaces: WorkspaceStore

  constructor(git: GitService, repos: RepoStore, workspaces: WorkspaceStore) {
    this.git = git
    this.repos = repos
    this.workspaces = workspaces
  }

  /** Validate a directory is a git repo, register it, and return live info. */
  async registerRepo(repoPathInput: string): Promise<RepoInfo> {
    const dir = normalizeRepoPath(repoPathInput)
    if (!(await this.git.isGitRepo(dir))) {
      throw new NotAGitRepoError(dir)
    }
    const root = await this.git.getRepoRoot(dir)
    const name = path.basename(root)
    const defaultBaseBranch = await this.git.getDefaultBaseBranch(root)

    this.repos.upsert({ path: root, name, defaultBaseBranch })

    return this.getRepoInfo(root)
  }

  /** Compose a stored repo record with live git branch data. */
  async getRepoInfo(repoPathInput: string): Promise<RepoInfo> {
    const root = normalizeRepoPath(repoPathInput)
    const record = this.repos.get(root)
    if (!record) throw new RepoNotFoundError(root)
    const branches = await this.git.listBranches(root)
    const currentBranch = await this.git.getCurrentBranch(root)
    return { ...record, branches, currentBranch }
  }

  /**
   * Create a workspace: a new branch + worktree off `baseBranch`, with any
   * configured gitignored files copied in, persisted as a Workspace row.
   */
  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const parsed = CreateWorkspaceInputSchema.parse(input)
    const root = normalizeRepoPath(parsed.repoPath)

    return withLock(root, async () => {
      if (!(await this.git.isGitRepo(root))) {
        throw new NotAGitRepoError(root)
      }
      const record = this.repos.get(root)
      const repoName = record?.name ?? path.basename(root)
      const baseBranch = parsed.baseBranch ?? (await this.git.getDefaultBaseBranch(root))

      // Find a branch + worktree-dir name unique against existing branches,
      // active workspaces, and on-disk dirs.
      const { branch, worktreePath } = await this.resolveUniqueNames(
        root,
        repoName,
        slugify(parsed.name)
      )

      // git worktree add creates the leaf dir; ensure its parent exists.
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true })

      await this.git.addWorktree(root, worktreePath, branch, baseBranch)

      // Copy configured gitignored files (e.g. .env.local) into the worktree.
      const patterns = record?.filesToCopy ?? []
      const copied = copyMatchingFiles(root, worktreePath, patterns)
      if (copied.length > 0) {
        log.info('workspace.files-copied', { count: copied.length })
      }

      const now = new Date().toISOString()
      const workspace: Workspace = {
        id: randomUUID(),
        repoPath: root,
        repoName,
        name: parsed.name,
        branch,
        baseBranch,
        worktreePath,
        agentType: parsed.agentType,
        sessionId: null,
        status: 'idle',
        createdAt: now,
        archivedAt: null
      }
      this.workspaces.insert(workspace)
      log.info('workspace.created', {
        id: workspace.id,
        repoName,
        branch,
        baseBranch
      })
      return workspace
    })
  }

  /**
   * List active workspaces for a repo, reconciled against git's actual
   * worktree list. Workspaces whose worktree has vanished on disk are logged
   * (they would surface as broken in the UI rather than being silently dropped).
   */
  async listWorkspaces(repoPathInput: string): Promise<Workspace[]> {
    const root = normalizeRepoPath(repoPathInput)
    const stored = this.workspaces.listByRepo(root, false)

    let liveByPath = new Set<string>()
    if (await this.git.isGitRepo(root)) {
      const live = await this.git.listWorktrees(root)
      liveByPath = new Set(live.map((w) => w.path))

      for (const ws of stored) {
        if (!liveByPath.has(ws.worktreePath) && !fs.existsSync(ws.worktreePath)) {
          log.warn('workspace.worktree-missing', { id: ws.id, worktreePath: ws.worktreePath })
        }
      }
      // Orphaned worktrees (on disk, no record) — informational only.
      const recorded = new Set(stored.map((w) => w.worktreePath))
      for (const w of live) {
        if (w.path !== root && !recorded.has(w.path)) {
          log.warn('workspace.orphan-worktree', { worktreePath: w.path, branch: w.branch })
        }
      }
    }
    return stored
  }

  async getWorkspace(id: string): Promise<Workspace> {
    const ws = this.workspaces.getById(id)
    if (!ws) throw new WorkspaceNotFoundError(id)
    return ws
  }

  /** Diff of a workspace's changes against its base branch. */
  async getDiff(id: string): Promise<WorkspaceDiff> {
    const ws = await this.getWorkspace(id)
    return this.git.getDiff(ws.worktreePath, ws.baseBranch)
  }

  /**
   * Remove a workspace's worktree and mark it archived. Refuses to remove a
   * worktree with uncommitted changes unless `force` is set, so work isn't lost
   * silently. The branch itself is kept.
   */
  async archiveWorkspace(id: string, force = false): Promise<void> {
    const ws = await this.getWorkspace(id)
    await withLock(ws.repoPath, async () => {
      if (!force && fs.existsSync(ws.worktreePath)) {
        if (await this.git.hasUncommittedChanges(ws.worktreePath)) {
          throw new WorkspaceDirtyError(
            'Workspace has uncommitted changes. Commit/discard them or archive with force.',
            { id, worktreePath: ws.worktreePath }
          )
        }
      }
      if (fs.existsSync(ws.worktreePath) || (await this.worktreeKnownToGit(ws))) {
        await this.git.removeWorktree(ws.repoPath, ws.worktreePath, force)
      }
      await this.git.pruneWorktrees(ws.repoPath)
      this.workspaces.markArchived(id)
      log.info('workspace.archived', { id, branch: ws.branch })
    })
  }

  // --- internals -----------------------------------------------------------

  private async worktreeKnownToGit(ws: Workspace): Promise<boolean> {
    if (!(await this.git.isGitRepo(ws.repoPath))) return false
    const live = await this.git.listWorktrees(ws.repoPath)
    return live.some((w) => w.path === ws.worktreePath)
  }

  /** Pick a branch (maestro/<slug>) and worktree dir not already in use. */
  private async resolveUniqueNames(
    root: string,
    repoName: string,
    slugBase: string
  ): Promise<{ branch: string; worktreePath: string }> {
    const live = (await this.git.listWorktrees(root)).map((w) => w.path)
    const liveSet = new Set(live)

    let attempt = 1
    for (;;) {
      const slug = attempt === 1 ? slugBase : `${slugBase}-${attempt}`
      const branch = `maestro/${slug}`
      const worktreePath = path.join(workspacesRoot(), repoName, slug)

      const taken =
        (await this.git.branchExists(root, branch)) ||
        this.workspaces.findActiveByRepoAndBranch(root, branch) !== undefined ||
        liveSet.has(worktreePath) ||
        fs.existsSync(worktreePath)

      if (!taken) return { branch, worktreePath }
      attempt++
    }
  }
}
