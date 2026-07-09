/**
 * Seeded fixtures for the screenshot harness — realistic data shaped exactly
 * like the real IPC payloads (the renderer re-validates every response with the
 * `@shared` zod schemas, so anything malformed would be rejected). One tidy repo
 * ("todo-app") with a handful of workspaces, a 3-way fan-out group, a DAG
 * workflow exercising every task status, usage/pricing for the cost dashboard,
 * and per-file diffs for the Monaco viewer.
 */
import type {
  AgentAuthStatus,
  CredentialInfo,
  FileDiff,
  PricingTable,
  QueuedJob,
  RepoInfo,
  RepoRecord,
  ReviewEvent,
  ReviewStatus,
  Task,
  TestResult,
  UsageEvent,
  Workflow,
  Workspace,
  WorkspaceDiff
} from '@shared/types'
import { DEFAULT_PRICING } from '@shared/cost'

const REPO_PATH = '/Users/you/code/todo-app'
export const REPO_NAME = 'todo-app'

// Stable, well-formed UUIDs (WorkspaceSchema requires uuid()).
const U = {
  wsSignup: '11111111-1111-4111-8111-111111111111',
  wsEmpty: '22222222-2222-4222-8222-222222222222',
  vA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  vB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  vC: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  workflow: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
} as const

export const GROUP_ID = 'group-empty-state-illustration'

const now = Date.UTC(2026, 6, 9, 0, 30, 0) // fixed clock for determinism
const iso = (offsetMin: number): string => new Date(now + offsetMin * 60_000).toISOString()

export const repoRecord: RepoRecord = {
  path: REPO_PATH,
  name: REPO_NAME,
  defaultBaseBranch: 'main',
  filesToCopy: ['.env.local'],
  testCommand: 'npm test',
  addedAt: iso(-600)
}

export const repoInfo: RepoInfo = {
  ...repoRecord,
  branches: ['main', 'develop'],
  currentBranch: 'main'
}

// --- Workspaces -------------------------------------------------------------

function ws(partial: Partial<Workspace> & Pick<Workspace, 'id' | 'name' | 'branch' | 'status'>): Workspace {
  return {
    repoPath: REPO_PATH,
    repoName: REPO_NAME,
    baseBranch: 'main',
    worktreePath: `${REPO_PATH}/.maestro/worktrees/${partial.branch}`,
    agentType: 'claude-code',
    sessionId: 'sess-' + partial.id.slice(0, 8),
    groupId: null,
    baseHeadAtCreation: 'abc1234',
    createdAt: iso(-120),
    archivedAt: null,
    ...partial
  }
}

export const workspaces: Workspace[] = [
  ws({
    id: U.wsSignup,
    name: 'Signup form validation',
    branch: 'maestro/signup-validation',
    status: 'awaiting_input'
  }),
  // Fan-out group: "Empty-state illustration" · 3 variants.
  ws({
    id: U.vA,
    name: 'Empty-state illustration · v1',
    branch: 'maestro/empty-state-v1',
    status: 'running',
    groupId: GROUP_ID,
    agentType: 'claude-code'
  }),
  ws({
    id: U.vB,
    name: 'Empty-state illustration · v2',
    branch: 'maestro/empty-state-v2',
    status: 'awaiting_input',
    groupId: GROUP_ID,
    agentType: 'claude-code'
  }),
  ws({
    id: U.vC,
    name: 'Empty-state illustration · v3',
    branch: 'maestro/empty-state-v3',
    status: 'running',
    groupId: GROUP_ID,
    agentType: 'codex'
  }),
  ws({
    id: U.wsEmpty,
    name: 'Inline edit todos',
    branch: 'maestro/inline-edit',
    status: 'idle'
  })
]

export const ids = U

// --- Diffs (list + per-file content for Monaco) -----------------------------

const SIGNUP_BEFORE = `export function SignupForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  function onSubmit(e) {
    e.preventDefault()
    api.signup({ email, password })
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Create account</button>
    </form>
  )
}
`

const SIGNUP_AFTER = `export function SignupForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function validate() {
    const next: Record<string, string> = {}
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) next.email = 'Enter a valid email address.'
    if (password.length < 8) next.password = 'Password must be at least 8 characters.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function onSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    api.signup({ email, password })
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <input value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
      {errors.email && <p className="field-error">{errors.email}</p>}
      <input value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
      {errors.password && <p className="field-error">{errors.password}</p>}
      <button type="submit">Create account</button>
    </form>
  )
}
`

export const diffByWorkspace: Record<string, WorkspaceDiff> = {
  [U.wsSignup]: {
    baseBranch: 'main',
    mergeBase: 'abc1234',
    files: [
      { path: 'src/components/SignupForm.tsx', status: 'modified' },
      { path: 'src/components/SignupForm.css', status: 'modified' },
      { path: 'src/lib/validation.ts', status: 'added' }
    ],
    patch: '',
    untracked: []
  },
  [U.vA]: {
    baseBranch: 'main',
    mergeBase: 'abc1234',
    files: [
      { path: 'src/components/EmptyState.tsx', status: 'added' },
      { path: 'src/assets/empty.svg', status: 'added' }
    ],
    patch: '',
    untracked: []
  },
  [U.vB]: {
    baseBranch: 'main',
    mergeBase: 'abc1234',
    files: [
      { path: 'src/components/EmptyState.tsx', status: 'added' },
      { path: 'src/components/EmptyState.css', status: 'added' },
      { path: 'src/App.tsx', status: 'modified' }
    ],
    patch: '',
    untracked: []
  },
  [U.vC]: {
    baseBranch: 'main',
    mergeBase: 'abc1234',
    files: [{ path: 'src/components/EmptyState.tsx', status: 'added' }],
    patch: '',
    untracked: []
  }
}

export const fileDiffs: Record<string, FileDiff> = {
  'src/components/SignupForm.tsx': {
    path: 'src/components/SignupForm.tsx',
    original: SIGNUP_BEFORE,
    modified: SIGNUP_AFTER,
    binary: false
  }
}

// Fallback file diff for any path not explicitly seeded (keeps Monaco happy).
export function fileDiffFor(path: string): FileDiff {
  return (
    fileDiffs[path] ?? {
      path,
      original: '// (base version)\n',
      modified: `// ${path}\n// generated by the agent in this worktree\nexport const ok = true\n`,
      binary: false
    }
  )
}

// --- Review status / history ------------------------------------------------

export const reviewStatusByWorkspace: Record<string, ReviewStatus> = {
  [U.wsSignup]: {
    hasUncommittedChanges: true,
    changedFileCount: 3,
    baseCheckedOut: true,
    baseBranch: 'main',
    baseAheadCount: 0
  }
}

export function reviewStatusFor(id: string): ReviewStatus {
  return (
    reviewStatusByWorkspace[id] ?? {
      hasUncommittedChanges: true,
      changedFileCount: diffByWorkspace[id]?.files.length ?? 1,
      baseCheckedOut: true,
      baseBranch: 'main',
      baseAheadCount: 0
    }
  )
}

export const reviewHistoryByWorkspace: Record<string, ReviewEvent[]> = {
  [U.wsSignup]: [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      workspaceId: U.wsSignup,
      repoPath: REPO_PATH,
      kind: 'pr',
      baseBranch: 'main',
      branch: 'maestro/signup-validation',
      url: 'https://github.com/you/todo-app/pull/42',
      committed: true,
      createdAt: iso(-40)
    },
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
      workspaceId: U.wsSignup,
      repoPath: REPO_PATH,
      kind: 'merge',
      baseBranch: 'main',
      branch: 'maestro/signup-copy',
      url: null,
      committed: true,
      createdAt: iso(-95)
    }
  ]
}

// --- Test results -----------------------------------------------------------

export const testResults: Record<string, TestResult> = {
  [U.vB]: {
    ok: true,
    exitCode: 0,
    output:
      '> todo-app@0.1.0 test\n> vitest run\n\n ✓ src/components/EmptyState.test.tsx (4)\n ✓ src/App.test.tsx (7)\n\n Test Files  2 passed (2)\n      Tests  11 passed (11)\n   Duration  1.84s\n',
    truncated: false,
    timedOut: false,
    durationMs: 1840,
    command: 'npm test',
    ranAt: iso(-3)
  },
  [U.vC]: {
    ok: false,
    exitCode: 1,
    output:
      '> todo-app@0.1.0 test\n> vitest run\n\n ❯ src/components/EmptyState.test.tsx (3)\n   × renders illustration when list is empty\n     → Unable to find element with data-testid="empty-state"\n\n Test Files  1 failed (1)\n      Tests  1 failed | 2 passed (3)\n',
    truncated: false,
    timedOut: false,
    durationMs: 2110,
    command: 'npm test',
    ranAt: iso(-2)
  }
}

// --- Queue ------------------------------------------------------------------

export const queue: QueuedJob[] = [
  {
    id: 'job-1',
    workspaceId: U.wsSignup,
    prompt: 'Add a password-strength meter under the password field',
    dependsOnWorkspaceId: null,
    createdAt: iso(-1)
  },
  {
    id: 'job-2',
    workspaceId: U.wsSignup,
    prompt: 'Write tests for the new validation rules',
    dependsOnWorkspaceId: U.vB,
    createdAt: iso(-1)
  }
]

// --- Workflow (every task status represented) -------------------------------

function task(t: Partial<Task> & Pick<Task, 'id' | 'title' | 'status' | 'dependsOn'>): Task {
  return {
    prompt: 'Do the thing described by this task.',
    agentId: null,
    retryCount: 0,
    conflict: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    failureReason: null,
    ...t
  }
}

export const workflow: Workflow = {
  id: U.workflow,
  name: 'Parallel refactor (diamond)',
  repoPath: REPO_PATH,
  baseBranch: 'main',
  status: 'running',
  maxConcurrency: 3,
  createdAt: now,
  tasks: [
    task({ id: 'prep', title: 'Prep / scaffolding', status: 'merged', dependsOn: [] }),
    task({ id: 'refactor-a', title: 'Refactor module A', status: 'running', dependsOn: ['prep'] }),
    task({ id: 'refactor-b', title: 'Refactor module B', status: 'completed', dependsOn: ['prep'] }),
    task({ id: 'verify', title: 'Integrate + verify', status: 'blocked', dependsOn: ['refactor-a', 'refactor-b'] })
  ]
}

// A second workflow showing rejected + cancelled colors, for the graph legend shot.
export const workflowRejected: Workflow = {
  id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddde',
  name: 'Feature + tests + docs',
  repoPath: REPO_PATH,
  baseBranch: 'main',
  status: 'running',
  maxConcurrency: 2,
  createdAt: now,
  tasks: [
    task({ id: 'feature', title: 'Implement feature', status: 'rejected', dependsOn: [] }),
    task({ id: 'tests', title: 'Add tests', status: 'cancelled', dependsOn: ['feature'] }),
    task({ id: 'docs', title: 'Write docs', status: 'cancelled', dependsOn: ['tests'] })
  ]
}

export const workflows: Workflow[] = [workflow, workflowRejected]

// --- Usage & pricing --------------------------------------------------------

export const pricing: PricingTable = DEFAULT_PRICING

let usageSeq = 0
function usage(
  workspaceId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  minutesAgo: number,
  workflowId: string | null = null
): UsageEvent {
  usageSeq += 1
  return {
    id: `usage-${usageSeq}`,
    workspaceId,
    taskId: null,
    workflowId,
    createdAt: iso(-minutesAgo),
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens: Math.round(inputTokens * 0.2),
    cacheReadTokens,
    cliCostUsd: null
  }
}

// A spread of turns over the session so the cumulative chart has a climbing curve.
export const usageEvents: UsageEvent[] = [
  usage(U.wsSignup, 'claude-sonnet-4-20250514', 42000, 3800, 120000, 28),
  usage(U.wsSignup, 'claude-sonnet-4-20250514', 18000, 2600, 90000, 22),
  usage(U.vA, 'claude-opus-4-20250514', 52000, 6100, 140000, 18),
  usage(U.vB, 'claude-sonnet-4-20250514', 31000, 4200, 110000, 14),
  usage(U.vC, 'claude-haiku-4-20250514', 26000, 3100, 60000, 11),
  usage(U.vA, 'claude-opus-4-20250514', 47000, 5400, 130000, 8),
  usage(U.wsSignup, 'claude-sonnet-4-20250514', 22000, 3000, 95000, 5),
  usage(U.vB, 'claude-sonnet-4-20250514', 15000, 2100, 70000, 2)
]

export const agentAuth: Record<string, AgentAuthStatus> = {
  'claude-code': { agentType: 'claude-code', installed: true, loggedIn: true },
  codex: { agentType: 'codex', installed: true, loggedIn: false },
  cursor: { agentType: 'cursor', installed: false, loggedIn: false }
}

export const credentials: Record<string, CredentialInfo> = {
  'claude-code': { agentType: 'claude-code', configured: false, kind: null, updatedAt: null },
  codex: { agentType: 'codex', configured: true, kind: 'api-key', updatedAt: iso(-500) },
  cursor: { agentType: 'cursor', configured: false, kind: null, updatedAt: null }
}

export const sessionStartedAt = iso(-30)

// A believable terminal scrollback for the raw-terminal shot.
export const terminalBuffer =
  [
    '\x1b[38;5;45m➜\x1b[0m  \x1b[36mempty-state-v2\x1b[0m git status',
    'On branch maestro/empty-state-v2',
    'Changes to be committed:',
    '  \x1b[32mnew file:   src/components/EmptyState.tsx\x1b[0m',
    '  \x1b[32mnew file:   src/components/EmptyState.css\x1b[0m',
    '  \x1b[32mmodified:   src/App.tsx\x1b[0m',
    '',
    '\x1b[38;5;45m➜\x1b[0m  \x1b[36mempty-state-v2\x1b[0m npm test',
    '\x1b[32m ✓\x1b[0m src/components/EmptyState.test.tsx (4)',
    '\x1b[32m ✓\x1b[0m src/App.test.tsx (7)',
    '',
    ' Test Files  \x1b[32m2 passed\x1b[0m (2)',
    '      Tests  \x1b[32m11 passed\x1b[0m (11)',
    '',
    '\x1b[38;5;45m➜\x1b[0m  \x1b[36mempty-state-v2\x1b[0m \x1b[5m▋\x1b[0m'
  ].join('\r\n') + '\r\n'
