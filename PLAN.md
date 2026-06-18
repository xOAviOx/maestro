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

**GitHub auth to push from a new machine.** Pushing must authenticate as the
repo owner (`xOAviOx`). If a machine already has a *different* GitHub login
cached (macOS stores it in Keychain via the `osxkeychain` credential helper),
pushes 403 with "Permission to xOAviOx/maestro denied to <other-user>". To fix:

```bash
# 1. Clear any stale github.com credential (macOS Keychain)
printf "protocol=https\nhost=github.com\n\n" | git credential-osxkeychain erase

# 2. Create a token on github.com as xOAviOx:
#    classic token  -> needs the `repo` scope
#    fine-grained   -> needs Contents: Read & write on the maestro repo
#    (a fine-grained token missing Contents:write authenticates but still 403s)

# 3. Save it so future pushes are automatic (macOS):
printf "protocol=https\nhost=github.com\nusername=xOAviOx\npassword=<TOKEN>\n\n" \
  | git credential-osxkeychain store
```

On Linux/Windows the helper differs (`store`/`cache` or Git Credential Manager),
but the steps are the same: clear stale creds, then save a `xOAviOx` PAT. SSH
(`git@github.com:xOAviOx/maestro.git` with a registered key) avoids tokens
entirely and is the cleanest option if you set up keys on the new machine.

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

## What's DONE (modules 0–6 + 4b, all typecheck-clean + smoke-verified)

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
- [x] **Module 4b — Raw terminal per workspace.** `PtyManager` (main) spawns a
      shell in the workspace's worktree via `node-pty`; `TerminalView` (renderer)
      renders it with xterm.js, wired through dedicated IPC channels. node-pty
      ships N-API prebuilds, so it needs no per-ABI rebuild. Smoke: `smoke:m4b`.
- [x] **Module 7 — Agent accounts (login).** Detect each agent CLI's install +
      login state and let the user sign in from within Maestro, without ever
      reading or storing tokens. `harness/authStatus.ts` probes each CLI's own
      status command (`claude auth status --json`, `codex login status`) and
      resolves its login command (`claude auth login`, `codex login`).
      `PtyManager.startCommand` runs that login flow in a pty so the user
      completes the CLI's OAuth handshake; the renderer binds an xterm to it
      (`LoginTerminal`) inside a Settings → Accounts panel (`SettingsDialog`,
      opened from the sidebar). Auth is detected only — credentials stay owned by
      the CLI (OS keychain / dotfiles); nothing is injected into agent env.
      `CodexHarness.isAvailable()` is now real (binary check) so the panel
      reflects Codex truthfully; its `run()` is still a stub. Smoke: `smoke:m7`.
- [x] **Module 7b — Headless/CI token fallback (opt-in).** An "Advanced" section
      per agent in the Accounts panel accepts a pasted token/API key for machines
      that can't run interactive OAuth. Stored encrypted via Electron
      `safeStorage` (OS keychain) in the `agent_credentials` table — `CredentialStore`
      keeps the secret **write-only** (set/clear from the UI; never returned to the
      renderer) and the engine stays Electron-free via an injected `SecretCipher`
      (smoke tests pass a fake cipher; a NULL cipher refuses to persist plaintext).
      At spawn the supervisor injects the decrypted secret as the right env var
      (`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) on top of
      the inherited env. CLI login remains the recommended default. Smoke: `smoke:m7`
      (encrypt-at-rest + reveal + clear + locked-cipher refusal).
- [x] **Module 8 — Codex harness.** `CodexHarness` drives the Codex CLI in
      headless structured-output mode (`codex exec --json -s workspace-write
      --skip-git-repo-check`, prompt piped via stdin; multi-turn continuity via
      `codex exec resume <sessionId>`), mirroring `ClaudeCodeHarness` (spawn,
      stream NDJSON, validate every event, cancel/process-tree-kill). Default
      sandbox is `workspace-write` (analog of Claude's `acceptEdits`);
      `danger-full-access` is NOT the default (hard constraint).
      `CodexStreamMapper` normalizes the documented thread-event stream
      (`thread.started`/`turn.started`/`item.*`/`turn.completed`/`turn.failed`)
      onto the shared `AgentEvent` union — synthesizing a `tool_use` for
      completed-only items (`file_change`/`web_search`), ignoring `reasoning`
      and transient reconnect `error` notices, defending against version field
      drift (`item.type` vs `item_type`, `agent_message` vs `assistant_message`).
      The harness factory now returns a real `CodexHarness`; no caller changed.
      Smoke: `smoke:m8` (deterministic mapper test on a recorded stream + a live
      two-turn resume test that skips when the `codex` CLI is absent).

---

## What's TO DO / deferred

- [ ] **macOS signed build.** `electron-builder.yml` has a stubbed mac/`dmg`
      target. Needs a Mac CI runner + signing/notarization. Develop & package on
      Windows first (current target), add mac as a later CI step.
- [ ] **Cursor harness.** `CursorHarness.run()` is still a stub — flesh out when
      that CLI is targeted. Pattern: implement the `Harness` interface + a stream
      mapper like `ClaudeStreamMapper`/`CodexStreamMapper`. (Codex is now done,
      Module 8; its mapper is a second reference for the pattern.)
      ⚠️ The Codex harness was built against the *documented* `exec --json`
      thread-event format — verify the live two-turn `smoke:m8` against a real
      `codex` install (resume id + usage fields especially) before relying on it.
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
