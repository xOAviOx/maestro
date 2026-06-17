# Maestro

A cross-platform desktop app (Windows + macOS, Electron) for running CLI coding
agents (starting with **Claude Code**) in parallel, each in its own isolated Git
worktree, and reviewing/merging their work from one UI.

The product value is **orchestration and review** — the agents already exist as
CLIs; Maestro is the shell that runs them in isolation, shows their work, and
helps ship it.

## Status

Built module-by-module. Current: **Module 0 — Scaffold**.

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
