import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { GitService } from './GitService'
import { RepoStore } from './store/RepoStore'
import { WorkspaceStore } from './store/WorkspaceStore'
import { ReviewEventStore } from './store/ReviewEventStore'
import {
  GhUnavailableError,
  MaestroError,
  MergeConflictError,
  NotAGitRepoError,
  NothingToMergeError,
  RepoNotFoundError,
  WorkspaceDirtyError,
  WorkspaceNotFoundError
} from './errors'
import { createPr, isGhAvailable } from './gh'
import { normalizeRepoPath, slugify, workspacesRoot } from './util/paths'
import { copyMatchingFiles } from './util/glob'
import { withLock } from './util/locks'
import { log } from '../log'
import {
  CreateWorkspaceInputSchema,
  FanOutInputSchema,
  type CreateWorkspaceInput,
  type FanOutInput,
  type FileDiff,
  type MergeResult,
  type PullRequestResult,
  type RepoInfo,
  type ReviewEvent,
  type ReviewStatus,
  type Workspace,
  type WorkspaceDiff
} from '@shared/types'

/** Files larger than this are treated as non-text for diffing. */
const MAX_DIFF_BYTES = 1_500_000

function hasNullByte(s: string): boolean {
  return s.includes('')
}

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
  private readonly reviewEvents: ReviewEventStore

  constructor(
    git: GitService,
    repos: RepoStore,
    workspaces: WorkspaceStore,
    reviewEvents: ReviewEventStore
  ) {
    this.git = git
    this.repos = repos
    this.workspaces = workspaces
    this.reviewEvents = reviewEvents
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
   * `opts.groupId` tags the workspace as a fan-out variant (siblings share it).
   */
  async createWorkspace(
    input: CreateWorkspaceInput,
    opts: { groupId?: string } = {}
  ): Promise<Workspace> {
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

      // Fresh-base verification (spec rule 4): the new worktree's HEAD must be
      // exactly the CURRENT base branch HEAD at this moment. This should be
      // impossible to violate (worktree add -b forks from the ref we pass), so
      // any mismatch is a loud internal error, never silently stale. The sha is
      // recorded on the workspace as the stale-base audit trail.
      const baseHead = await this.git.revParse(root, baseBranch)
      const worktreeHead = await this.git.revParse(worktreePath, 'HEAD')
      if (baseHead !== worktreeHead) {
        throw new MaestroError(
          'INTERNAL',
          `Fresh-base verification failed: worktree HEAD ${worktreeHead} != ${baseBranch} HEAD ${baseHead}.`,
          { branch, baseBranch, baseHead, worktreeHead }
        )
      }
      log.info('workspace.fresh-base-verified', { branch, baseBranch, baseHead })

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
        groupId: opts.groupId ?? null,
        baseHeadAtCreation: baseHead,
        createdAt: now,
        archivedAt: null
      }
      this.workspaces.insert(workspace)
      log.info('workspace.created', {
        id: workspace.id,
        repoName,
        branch,
        baseBranch,
        groupId: workspace.groupId
      })
      return workspace
    })
  }

  /**
   * Fan-out: create one workspace per variant, all sharing a fresh groupId, so
   * the same task can be raced across different agents/models in isolated
   * worktrees. Each variant is created independently (its own branch + worktree
   * via createWorkspace, which serializes per-repo). Returns the variant
   * workspaces in input order; the caller (supervisor) starts their first turns.
   */
  async createFanOut(input: FanOutInput): Promise<Workspace[]> {
    const parsed = FanOutInputSchema.parse(input)
    const groupId = randomUUID()
    const created: Workspace[] = []
    for (let i = 0; i < parsed.variants.length; i++) {
      const variant = parsed.variants[i]!
      const ws = await this.createWorkspace(
        {
          repoPath: parsed.repoPath,
          name: `${parsed.name} · v${i + 1}`,
          baseBranch: parsed.baseBranch,
          agentType: variant.agentType
        },
        { groupId }
      )
      created.push(ws)
    }
    log.info('workspace.fan-out', { groupId, variants: created.length })
    return created
  }

  /**
   * Archive every active workspace in a fan-out group except `keepId` (the
   * winner). Each removal reuses the standard archive path; a variant with
   * uncommitted changes is force-removed since the user explicitly chose the
   * winner and is discarding the rest.
   */
  async archiveGroupExcept(groupId: string, keepId: string): Promise<void> {
    const siblings = this.workspaces.listByGroup(groupId).filter((w) => w.id !== keepId)
    for (const ws of siblings) {
      await withLock(ws.repoPath, () => this.archiveCore(ws, true))
    }
    log.info('workspace.group-pruned', { groupId, keepId, archived: siblings.length })
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
   * Full base-vs-worktree content for a single file, for the side-by-side diff
   * editor. `original` is the file at the merge-base (using `oldPath` for
   * renames); `modified` is the current worktree file. Large/binary files are
   * flagged and returned without content.
   */
  async getFileDiff(id: string, filePath: string, oldPath?: string): Promise<FileDiff> {
    const ws = await this.getWorkspace(id)
    const mergeBase = await this.git.getMergeBase(ws.worktreePath, ws.baseBranch)
    const original = await this.git.getFileAtRef(ws.worktreePath, mergeBase, oldPath ?? filePath)

    let modified: string | null = null
    const abs = path.join(ws.worktreePath, ...filePath.split('/'))
    try {
      const stat = fs.statSync(abs)
      if (stat.isFile() && stat.size <= MAX_DIFF_BYTES) {
        modified = fs.readFileSync(abs, 'utf8')
      } else if (stat.isFile()) {
        // Too large to diff as text.
        return { path: filePath, original: '', modified: '', binary: true }
      }
    } catch {
      modified = null // deleted in worktree
    }

    const orig = original ?? ''
    const mod = modified ?? ''
    const binary = hasNullByte(orig) || hasNullByte(mod)
    return {
      path: filePath,
      original: binary ? '' : orig,
      modified: binary ? '' : mod,
      binary
    }
  }

  /**
   * Remove a workspace's worktree and mark it archived. Refuses to remove a
   * worktree with uncommitted changes unless `force` is set, so work isn't lost
   * silently. The branch itself is kept.
   */
  async archiveWorkspace(id: string, force = false): Promise<void> {
    const ws = await this.getWorkspace(id)
    await withLock(ws.repoPath, () => this.archiveCore(ws, force))
  }

  /** Lock-free archive body, so callers already holding the repo lock (merge)
   * can reuse it without deadlocking. */
  private async archiveCore(ws: Workspace, force: boolean): Promise<void> {
    if (!force && fs.existsSync(ws.worktreePath)) {
      if (await this.git.hasUncommittedChanges(ws.worktreePath)) {
        throw new WorkspaceDirtyError(
          'Workspace has uncommitted changes. Commit/discard them or archive with force.',
          { id: ws.id, worktreePath: ws.worktreePath }
        )
      }
    }
    if (fs.existsSync(ws.worktreePath) || (await this.worktreeKnownToGit(ws))) {
      await this.git.removeWorktree(ws.repoPath, ws.worktreePath, force)
    }
    await this.git.pruneWorktrees(ws.repoPath)
    this.workspaces.markArchived(ws.id)
    log.info('workspace.archived', { id: ws.id, branch: ws.branch })
  }

  // --- Module 6: review, merge, PR -----------------------------------------

  /** Live review status for the ReviewBar. */
  async getReviewStatus(id: string): Promise<ReviewStatus> {
    const ws = await this.getWorkspace(id)
    const onDisk = fs.existsSync(ws.worktreePath)
    const hasUncommittedChanges = onDisk
      ? await this.git.hasUncommittedChanges(ws.worktreePath)
      : false
    const diff = onDisk
      ? await this.git.getDiff(ws.worktreePath, ws.baseBranch)
      : { files: [] as unknown[] }
    const baseWt = await this.git.findWorktreeForBranch(ws.repoPath, ws.baseBranch)
    return {
      hasUncommittedChanges,
      changedFileCount: diff.files.length,
      baseCheckedOut: baseWt !== null,
      baseBranch: ws.baseBranch,
      baseAheadCount: await this.getBaseAheadCount(id)
    }
  }

  /**
   * How many commits the base branch has gained since this worktree diverged
   * from it (0 = worktree is current). Best-effort: 0 whenever it can't be
   * determined (missing worktree, unborn refs, git failure) — staleness is a
   * hint, never a gate.
   */
  async getBaseAheadCount(id: string): Promise<number> {
    const ws = await this.getWorkspace(id)
    if (!fs.existsSync(ws.worktreePath)) return 0
    try {
      const mergeBase = await this.git.getMergeBase(ws.worktreePath, ws.baseBranch)
      return await this.git.commitCountBetween(ws.worktreePath, mergeBase, ws.baseBranch)
    } catch {
      return 0
    }
  }

  /**
   * Bring a workspace's worktree current with its base branch (Phase 1.2
   * rebase-on-stale-base). Auto-commits any uncommitted agent work first (a
   * rebase needs a clean tree — same pre-step as mergeWorkspace), fast-paths
   * when already current, otherwise rebases. On conflict the rebase is aborted
   * (worktree untouched) and the conflicted files are returned for the task's
   * conflict sub-state — never auto-resolved.
   */
  async rebaseOntoBase(id: string): Promise<{
    upToDate: boolean
    rebased: boolean
    conflicted: string[]
    committed: boolean
  }> {
    const ws = await this.getWorkspace(id)
    return withLock(ws.repoPath, async () => {
      if (!fs.existsSync(ws.worktreePath)) {
        // Nothing on disk to rebase (already archived?) — treat as current.
        return { upToDate: true, rebased: false, conflicted: [], committed: false }
      }
      let committed = false
      if (await this.git.hasUncommittedChanges(ws.worktreePath)) {
        committed = await this.git.commitAll(ws.worktreePath, `Maestro: ${ws.name} (auto-commit)`)
      }
      const baseHead = await this.git.revParse(ws.repoPath, ws.baseBranch)
      const mergeBase = await this.git.getMergeBase(ws.worktreePath, ws.baseBranch)
      if (baseHead === mergeBase) {
        return { upToDate: true, rebased: false, conflicted: [], committed }
      }
      const result = await this.git.rebase(ws.worktreePath, ws.baseBranch)
      if (!result.ok) {
        log.warn('workspace.rebase-conflict', {
          id,
          branch: ws.branch,
          baseBranch: ws.baseBranch,
          files: result.conflicted.length
        })
        return { upToDate: false, rebased: false, conflicted: result.conflicted, committed }
      }
      log.info('workspace.rebased', { id, branch: ws.branch, baseBranch: ws.baseBranch })
      return { upToDate: false, rebased: true, conflicted: [], committed }
    })
  }

  /** Persisted history of review outcomes (merges + PRs) for a workspace, newest first. */
  async listReviewEvents(id: string): Promise<ReviewEvent[]> {
    // Resolve the workspace first so unknown ids surface a WorkspaceNotFoundError
    // rather than silently returning an empty list.
    await this.getWorkspace(id)
    return this.reviewEvents.listByWorkspace(id)
  }

  /** Commit all current changes in the worktree. Returns true if a commit was made. */
  async commitWorkspace(id: string, message: string): Promise<boolean> {
    const ws = await this.getWorkspace(id)
    return withLock(ws.repoPath, () => this.git.commitAll(ws.worktreePath, message))
  }

  /**
   * Commit any uncommitted work, then merge the workspace branch into its base
   * (in whichever worktree has the base checked out). On conflict the merge is
   * aborted and a MergeConflictError is thrown. Optionally archives afterward.
   */
  async mergeWorkspace(
    id: string,
    options: { commitMessage?: string; archiveAfter?: boolean } = {}
  ): Promise<MergeResult> {
    const ws = await this.getWorkspace(id)
    return withLock(ws.repoPath, async () => {
      let committed = false
      if (await this.git.hasUncommittedChanges(ws.worktreePath)) {
        committed = await this.git.commitAll(
          ws.worktreePath,
          options.commitMessage ?? `Maestro: ${ws.name}`
        )
      }

      const ahead = await this.git.commitCountBetween(ws.worktreePath, ws.baseBranch, 'HEAD')
      if (ahead === 0) {
        throw new NothingToMergeError(
          `Nothing to merge: ${ws.branch} has no commits beyond ${ws.baseBranch}.`,
          { id, branch: ws.branch, baseBranch: ws.baseBranch }
        )
      }

      const baseWorktree = await this.git.findWorktreeForBranch(ws.repoPath, ws.baseBranch)
      if (!baseWorktree) {
        throw new MaestroError(
          'INTERNAL',
          `Base branch "${ws.baseBranch}" is not checked out in any worktree; check it out in the main repo to merge.`,
          { baseBranch: ws.baseBranch }
        )
      }

      const message = `Merge ${ws.branch} into ${ws.baseBranch} (Maestro)`
      const result = await this.git.merge(baseWorktree, ws.branch, message)
      if (!result.ok) {
        throw new MergeConflictError(result.conflicted, {
          branch: ws.branch,
          baseBranch: ws.baseBranch
        })
      }

      this.workspaces.setStatus(id, 'done')
      this.reviewEvents.record({
        workspaceId: id,
        repoPath: ws.repoPath,
        kind: 'merge',
        baseBranch: ws.baseBranch,
        branch: ws.branch,
        committed
      })
      log.info('workspace.merged', { id, branch: ws.branch, baseBranch: ws.baseBranch })

      if (options.archiveAfter) {
        // Worktree is clean after committing; safe to remove without force.
        await this.archiveCore(ws, false)
      }
      return { merged: true, committed, baseBranch: ws.baseBranch, branch: ws.branch }
    })
  }

  async isGhAvailable(): Promise<boolean> {
    return isGhAvailable()
  }

  /**
   * Commit any uncommitted work, push the branch to origin, and open a PR via
   * the GitHub CLI. Requires `gh` (installed + authenticated) and an `origin`
   * remote; otherwise throws GhUnavailableError.
   */
  async createPullRequest(
    id: string,
    options: { title?: string; body?: string; commitMessage?: string } = {}
  ): Promise<PullRequestResult> {
    const ws = await this.getWorkspace(id)
    if (!(await isGhAvailable())) {
      throw new GhUnavailableError(
        'GitHub CLI (gh) not found or not authenticated. Install gh and run `gh auth login`.'
      )
    }
    return withLock(ws.repoPath, async () => {
      let committed = false
      if (await this.git.hasUncommittedChanges(ws.worktreePath)) {
        committed = await this.git.commitAll(
          ws.worktreePath,
          options.commitMessage ?? `Maestro: ${ws.name}`
        )
      }
      const remotes = await this.git.listRemotes(ws.worktreePath)
      if (!remotes.includes('origin')) {
        throw new GhUnavailableError('No "origin" remote to push to.')
      }
      await this.git.push(ws.worktreePath, 'origin', ws.branch)
      const url = await createPr(ws.worktreePath, {
        base: ws.baseBranch,
        head: ws.branch,
        title: options.title ?? ws.name,
        body: options.body ?? ''
      })
      this.reviewEvents.record({
        workspaceId: id,
        repoPath: ws.repoPath,
        kind: 'pr',
        baseBranch: ws.baseBranch,
        branch: ws.branch,
        url,
        committed
      })
      log.info('workspace.pr-created', { id, branch: ws.branch })
      return { url, committed }
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
