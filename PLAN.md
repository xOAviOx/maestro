# Maestro — Build Plan & Status

> Continuation doc so the project can be picked up on any machine.
> Last updated: 2026-06-18.

Maestro is a cross-platform Electron desktop app that runs CLI coding agents
(starting with **Claude Code**) in parallel, each in its own isolated Git
worktree, and lets you review/merge their work from one UI. The agents already
exist as CLIs — Maestro is the orchestration + review shell around them.

---

## Pick up on a new computer

```bash
git clone git@github.com:xOAviOx/maestro.git
cd maestro
npm install            # leaves better-sqlite3 on the Node ABI

# To RUN the app (Electron ABI):
npm run rebuild:electron
npm run dev

# To run the headless smoke tests (Node ABI):
npm run rebuild:node
npm run smoke:m1   # … through smoke:m6
```

**Prerequisites:** Node 18+, Git, and the **Claude Code CLI** on PATH (for the
harness to actually drive an agent). The **GitHub CLI (`gh`)**, authenticated,
is optional — only needed for the "Create PR" action; everything degrades
gracefully without it.

**ABI gotcha:** `better-sqlite3` is native and must match whatever runs it.
Running the app needs the Electron ABI (`rebuild:electron`); running smoke tests
under plain Node/tsx needs the Node ABI (`rebuild:node`). Switching between the
two requires re-running the matching rebuild. See README "Native modules & ABI".

---

## Architecture (where things live)

```
maestro/
├── shared/            # types + zod schemas shared across main/preload/renderer
│   ├── types.ts       # all domain types, zod schemas, error codes
│   └── ipc.ts         # IPC channel names + payload contracts
├── src/
│   ├── main/          # Electron main process — the only place fs/git/processes run
│   │   ├── index.ts   # app entry: wires engine + supervisor + push broadcasting
│   │   ├── ipc/       # ipcMain handlers — validate payload (zod) + delegate
│   │   ├── engine/    # GitService, WorktreeManager, WorkspaceSupervisor, store, gh
│   │   └── harness/   # Harness interface + ClaudeCodeHarness + Codex/Cursor stubs
│   ├── preload/       # contextBridge: exposes a typed `window.maestro`
│   └── renderer/      # React + Tailwind + Zustand UI
└── scripts/           # module1..6 headless smoke tests
```

**Security posture (hard constraints — do not regress):**
- All `fs` / `child_process` / `node-pty` access lives in **main** only.
- Renderer is sandboxed: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`; talks to main only through the typed preload bridge.
- Every IPC payload and every parsed agent stream event is validated with **zod**.
- TypeScript strict mode; no `any`.

---

## What's DONE (modules 0–6, all typecheck-clean + smoke-verified)

- [x] **Module 0 — Scaffold.** Electron + electron-vite + React + TypeScript +
      Tailwind. Security hardening (sandbox, contextIsolation, CSP). Build,
      typecheck, and packaging config (`electron-builder.yml`).
- [x] **Module 1 — Orchestration engine.** `GitService` (git plumbing),
      `WorktreeManager` (create/list/archive isolated worktrees per workspace),
      SQLite store (`Database`, `RepoStore`, `WorkspaceStore`), utils
      (`glob`, `locks`, `paths`). Smoke: `smoke:m1`.
- [x] **Module 2 — Harness layer.** `Harness` interface, `ClaudeCodeHarness`
      (spawn Claude Code, stream + map events via `ClaudeStreamMapper`, session
      resumption), `resolveBinary` (cross-platform PATH resolution),
      `CodexHarness`/`CursorHarness` stubs. Smoke: `smoke:m2`.
- [x] **Module 3 — IPC bridge.** Preload `MaestroApi` (typed), main process
      wiring of engine + supervisor + push broadcasting to renderer, renderer
      IPC client with zod response validation + `MaestroClientError`. Shared
      error codes + `ErrorPayload`. Smoke: `smoke:m3` (concurrent agents with
      worktree isolation verified).
- [x] **Module 4 — UI shell.** `App`, `WorkspaceSidebar`, `NewWorkspaceDialog`,
      `AgentChat` (live transcript), `WorkspaceView`, `StatusDot`, Zustand
      `store`, openRepo workflow + native directory-picker dialog. Verified live
      in the running dev app.
- [x] **Module 5 — Diff engine.** `FileDiff` schemas, GitService merge-base /
      file-ref ops, `workspaceFileDiff` IPC, `DiffViewer` (Monaco, configured for
      offline/web-worker use), tab-based Chat/Diff workspace view. Smoke: `smoke:m5`.
- [x] **Module 6 — Merge & review.** `ReviewStatus`/`MergeResult`/
      `PullRequestResult` schemas + commit/merge/PR inputs; error codes
      `MERGE_CONFLICT` / `NOTHING_TO_MERGE` / `GH_UNAVAILABLE` with matching
      `MaestroError` subclasses; `engine/gh.ts` (graceful `gh` CLI wrapper);
      `ReviewBar` component (commit + merge / Create PR / archive-after-merge,
      surfaces conflicts explicitly); merge logic that **aborts cleanly on
      conflict and reports the conflicted files** (never silently fails).
      Smoke: `smoke:m6` (happy-path merge, clean conflict abort, archive).

---

## What's TO DO / deferred

- [ ] **Module 4b — Raw terminal per workspace** (optional). Embed an xterm.js
      terminal backed by `node-pty` in main, so a workspace can drop to a shell
      in its worktree. The only intentionally-deferred core item.
- [ ] **macOS signed build.** `electron-builder.yml` has a stubbed mac/`dmg`
      target. Needs a Mac CI runner + signing/notarization. Develop & package on
      Windows first (current target), add mac as a later CI step.
- [ ] **Additional agent harnesses.** `CodexHarness` / `CursorHarness` are stubs
      — flesh out when those CLIs are targeted. Pattern: implement the `Harness`
      interface + a stream mapper like `ClaudeStreamMapper`.
- [ ] **Persisted PR/merge history & richer review UX** (nice-to-have): show prior
      merge outcomes / open PR links per workspace beyond the transient `ReviewBar`
      outcome banner.

---

## Conventions / gotchas to remember

- **Cross-platform paths:** always build with Node `path` + `os.homedir()`;
  never hardcode `/` or `~`. Split git output on `/\r?\n/`.
- **Line endings:** Windows git checks out CRLF (correct product behavior);
  tests normalize with `.replace(/\r\n/g, '\n')` before comparing content.
- **Adding an IPC method** touches 5 places, keep them in sync:
  `shared/ipc.ts` (channel) → `src/main/ipc/index.ts` (handler + zod validate) →
  `src/preload/index.ts` (bridge) → `src/renderer/ipc.ts` (client wrapper) →
  call site in a component/store.
- **Always run `npm run typecheck` before committing** (strict, no `any`).
