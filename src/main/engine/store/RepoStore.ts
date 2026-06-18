import type { Db } from './Database'
import type { RepoRecord } from '@shared/types'

interface RepoRow {
  path: string
  name: string
  default_base_branch: string
  files_to_copy: string
  test_command: string | null
  added_at: string
}

function rowToRecord(row: RepoRow): RepoRecord {
  let filesToCopy: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.files_to_copy)
    if (Array.isArray(parsed)) {
      filesToCopy = parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch {
    filesToCopy = []
  }
  return {
    path: row.path,
    name: row.name,
    defaultBaseBranch: row.default_base_branch,
    filesToCopy,
    testCommand: row.test_command ?? null,
    addedAt: row.added_at
  }
}

/** Persistence for the user's known repos and their files-to-copy config. */
export class RepoStore {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  /** Insert or update a repo record (keyed by path). Preserves files_to_copy
   * and test_command if the repo already exists and none are supplied. */
  upsert(
    record: Omit<RepoRecord, 'addedAt' | 'filesToCopy' | 'testCommand'> & {
      filesToCopy?: string[]
      testCommand?: string | null
    }
  ): void {
    const existing = this.get(record.path)
    const filesToCopy = record.filesToCopy ?? existing?.filesToCopy ?? []
    const testCommand = record.testCommand ?? existing?.testCommand ?? null
    const addedAt = existing?.addedAt ?? new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO repos (path, name, default_base_branch, files_to_copy, test_command, added_at)
         VALUES (@path, @name, @defaultBaseBranch, @filesToCopy, @testCommand, @addedAt)
         ON CONFLICT(path) DO UPDATE SET
           name = excluded.name,
           default_base_branch = excluded.default_base_branch,
           files_to_copy = excluded.files_to_copy,
           test_command = excluded.test_command`
      )
      .run({
        path: record.path,
        name: record.name,
        defaultBaseBranch: record.defaultBaseBranch,
        filesToCopy: JSON.stringify(filesToCopy),
        testCommand,
        addedAt
      })
  }

  get(repoPath: string): RepoRecord | undefined {
    const row = this.db.prepare('SELECT * FROM repos WHERE path = ?').get(repoPath) as
      | RepoRow
      | undefined
    return row ? rowToRecord(row) : undefined
  }

  list(): RepoRecord[] {
    const rows = this.db.prepare('SELECT * FROM repos ORDER BY added_at DESC').all() as RepoRow[]
    return rows.map(rowToRecord)
  }

  setFilesToCopy(repoPath: string, patterns: string[]): void {
    this.db
      .prepare('UPDATE repos SET files_to_copy = ? WHERE path = ?')
      .run(JSON.stringify(patterns), repoPath)
  }

  /** Set (or clear, with null) the per-repo test command. */
  setTestCommand(repoPath: string, testCommand: string | null): void {
    this.db
      .prepare('UPDATE repos SET test_command = ? WHERE path = ?')
      .run(testCommand, repoPath)
  }
}
