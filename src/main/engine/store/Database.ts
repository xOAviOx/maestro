import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { defaultDbPath } from '../util/paths'

export type Db = Database.Database

/**
 * Opens (creating if needed) the Maestro SQLite database and applies the
 * schema. Synchronous by design (better-sqlite3). The db path can be overridden
 * for tests; production uses <home>/.maestro/maestro.db.
 *
 * NOTE: better-sqlite3 is a native module. Test scripts run under plain Node
 * (matching the installed prebuilt ABI). When the engine runs inside Electron
 * (dev/packaged) the module must be rebuilt for Electron's ABI — electron-builder
 * does this at package time via `install-app-deps`; dev needs `@electron/rebuild`.
 */
export function openDatabase(dbPath: string = defaultDbPath()): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      path                TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      default_base_branch TEXT NOT NULL,
      files_to_copy       TEXT NOT NULL DEFAULT '[]',
      added_at            TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id            TEXT PRIMARY KEY,
      repo_path     TEXT NOT NULL,
      repo_name     TEXT NOT NULL,
      name          TEXT NOT NULL,
      branch        TEXT NOT NULL,
      base_branch   TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      agent_type    TEXT NOT NULL,
      session_id    TEXT,
      status        TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      archived_at   TEXT
    );

    -- One branch per repo (enforces the one-branch-per-worktree rule at the
    -- persistence layer; git enforces it at the worktree layer).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_repo_branch
      ON workspaces (repo_path, branch);

    CREATE INDEX IF NOT EXISTS idx_ws_repo ON workspaces (repo_path);

    -- Optional headless/CI credential fallback: a single secret per agent type,
    -- stored as ciphertext (Electron safeStorage / OS keychain). Plaintext never
    -- touches disk and is never returned to the renderer. Most users rely on the
    -- agent CLI's own login instead and never populate this table.
    CREATE TABLE IF NOT EXISTS agent_credentials (
      agent_type  TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      ciphertext  BLOB NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- Append-only history of review outcomes (merges + PRs) per workspace, so the
    -- UI can show prior results beyond the transient ReviewBar banner. Rows are
    -- kept after a workspace is archived (the workspace row itself is retained,
    -- only flagged archived), so history survives the worktree being removed.
    CREATE TABLE IF NOT EXISTS review_events (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      repo_path    TEXT NOT NULL,
      kind         TEXT NOT NULL,            -- 'merge' | 'pr'
      base_branch  TEXT NOT NULL,
      branch       TEXT NOT NULL,
      url          TEXT,                     -- PR url; null for merges
      committed    INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_review_ws ON review_events (workspace_id);

    -- Module 9 — DAG scheduler. A workflow is a set of tasks with dependency
    -- edges; tasks spawn Workspaces (worktree+agent) as their deps merge. State
    -- lives in SQLite so an app restart can recover the graph (running tasks are
    -- marked failed/interrupted; the rest of the DAG is intact).
    CREATE TABLE IF NOT EXISTS workflows (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      repo_path       TEXT NOT NULL,
      base_branch     TEXT NOT NULL,
      status          TEXT NOT NULL,            -- draft|running|paused|completed|failed
      max_concurrency INTEGER NOT NULL,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      workflow_id    TEXT NOT NULL,
      id             TEXT NOT NULL,             -- unique within its workflow
      title          TEXT NOT NULL,
      prompt         TEXT NOT NULL,
      depends_on     TEXT NOT NULL DEFAULT '[]',-- JSON array of sibling task ids
      status         TEXT NOT NULL,             -- see TASK_STATUSES
      agent_id       TEXT,                      -- linked workspace id once spawned
      retry_count    INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      started_at     INTEGER,
      finished_at    INTEGER,
      failure_reason TEXT,
      PRIMARY KEY (workflow_id, id),
      FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON tasks (workflow_id);
  `)

  // Additive column migrations (idempotent): add only if the column is absent,
  // so older databases upgrade in place without losing rows.
  addColumnIfMissing(db, 'workspaces', 'group_id', 'TEXT')
  addColumnIfMissing(db, 'repos', 'test_command', 'TEXT')
}

/** Add `column` to `table` if it doesn't already exist. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so we inspect the table schema first. */
function addColumnIfMissing(db: Db, table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}
