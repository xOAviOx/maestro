# Maestro

A cross-platform desktop app (Windows + macOS, Electron) for running CLI coding
agents (starting with **Claude Code**) in parallel, each in its own isolated Git
worktree, and reviewing/merging their work from one UI.

The product value is **orchestration and review** — the agents already exist as
CLIs; Maestro is the shell that runs them in isolation, shows their work, and
helps ship it.

## Status

All modules (0–6 + 4b) are built and verified: scaffold, orchestration engine,
harness layer (Claude Code), workspace supervisor, UI shell, Monaco diff viewer,
merge/PR/archive, and a raw terminal per workspace (node-pty + xterm).

Each module has a headless smoke test: `npm run smoke:m1` … `smoke:m6` plus
`smoke:m4b` (run `npm run rebuild:node` first — see ABI note below; `smoke:m4b`
works on either ABI since node-pty ships N-API prebuilds).

## Native modules & ABI (important for dev)

`better-sqlite3` is a native module and must match the ABI of whatever runs it:

- **Running the app** (`npm run dev` / packaged) needs the **Electron** ABI:
  run `npm run rebuild:electron` once (after install, or after switching back from
  smoke tests).
- **Running the engine smoke tests** (`npm run smoke:m1/2/3`, plain Node via tsx)
  needs the **Node** ABI: run `npm run rebuild:node` first.

Switching between the two requires re-running the matching rebuild. `npm install`
leaves it on the Node ABI.

## Architecture

```
maestro/
├── shared/            # types + zod schemas shared across main/preload/renderer
├── src/
│   ├── main/          # Electron main process — the engine (fs, git, processes)
│   │   ├── ipc/       # ipcMain handlers — validate payload + delegate
│   │   ├── engine/    # GitService, WorktreeManager, WorkspaceSupervisor, store
│   │   └── harness/   # Harness interface + Claude Code impl + stubs
│   ├── preload/       # contextBridge: exposes typed `window.maestro`
│   └── renderer/      # React + Tailwind + Zustand UI
```

Security posture (hard constraints):

- All `fs` / `child_process` / `node-pty` access lives in **main** only.
- Renderer is sandboxed (`contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`) and talks to main only through the typed preload bridge.
- Every IPC payload and parsed agent event is validated with **zod**.
- TypeScript strict mode; no `any`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Launch the app with HMR (electron-vite dev). |
| `npm run typecheck` | Strict type-check main+preload and renderer. |
| `npm run build` | Typecheck + bundle main/preload/renderer to `out/`. |
| `npm run package:win` | Build + produce a Windows NSIS installer in `dist/`. |
| `npm run package:dir` | Build + produce an unpacked app dir (fast, no installer). |

## Cross-platform notes

Paths are always built with Node's `path` module and `os.homedir()` — never
hardcoded `/` or `~`. Git output is split on `/\r?\n/`. Develop and package on
Windows first; a signed macOS `dmg` build is a later CI step on a Mac runner
(the target is stubbed in `electron-builder.yml`).
