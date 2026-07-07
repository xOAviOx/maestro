# Maestro — Feature Walkthrough & Demo Script

A complete guide to every feature in Maestro, written so you can narrate a portfolio video. Each section has three parts:

- **What it is** — the one-line pitch (say this on camera).
- **How to use it** — the exact clicks/keys to perform.
- **Talking point** — the engineering substance worth calling out for a portfolio audience.

> Tip: record in the order of the [Suggested Storyboard](#suggested-storyboard) at the bottom — it tells a story (create → run → review → orchestrate → measure) instead of clicking around randomly.

---

## 0. What Maestro is (the opening line)

> "Maestro is an Electron desktop app that orchestrates multiple AI coding agents running **in parallel**, each isolated in its own Git worktree. You can run one task as competing variants, chain tasks into a dependency graph, review every diff before it merges, and watch token cost in real time."

**Architecture in one breath (for the intro):**
- **Electron main process** owns everything stateful: agent lifecycle, Git worktrees, the DAG scheduler, SQLite persistence, and cost collection.
- **React + TypeScript renderer** is deliberately "dumb" — it renders what main reports and sends intents over a typed IPC bridge.
- **Every agent gets its own Git worktree** branched from a base branch, so parallel agents never step on each other.
- **Zod validates every payload** crossing the IPC boundary; the renderer never touches `fs`/child processes directly.

---

## 1. Getting it running

**What it is:** A dev build launched with `electron-vite`.

**How to use it:**
1. `npm install`
2. Native modules must match Electron's ABI. If you see a `NODE_MODULE_VERSION` error on launch, rebuild `better-sqlite3` for Electron:
   ```bash
   cd node_modules/better-sqlite3
   npx --no-install prebuild-install -r electron -t 33.4.11 --arch x64 --platform win32
   ```
   (The terminal feature also uses `node-pty`; if the integrated terminal errors, rebuild it the same way.)
3. `npm run dev` — this builds the main/preload bundles, starts the Vite dev server on `localhost:5173`, and opens the app window.

**Talking point:** Native modules (`better-sqlite3`, `node-pty`) are compiled against a specific Node ABI. Electron ships its own ABI, so they must be rebuilt/prebuilt for the Electron runtime — a classic desktop-app gotcha worth mentioning to show you understand the native/JS boundary.

> ⚠️ Keep the repo you point Maestro at **outside** OneDrive. OneDrive can evict/corrupt loose `.git` objects, which breaks `git worktree add`.

---

## 2. The layout: sidebar + three views

**What it is:** A left rail (repos + a view switcher) and a main panel that swaps between three top-level views.

**How to use it:** The rail has a segmented switch with three tabs:
- **Workspaces** — the single-agent workbench.
- **Workflows** — the DAG scheduler / graph view.
- **Cost** — the live cost & usage dashboard.

At the bottom of the rail: an **account status** chip (Claude Code logged-in state) and a **Keyboard shortcuts** button. Top-left has the **Settings** gear.

**Talking point:** The active view, active tab, and open dialog all live in the Zustand store — that's why keyboard shortcuts can drive the UI from anywhere without prop-drilling.

---

## 3. Repositories

**What it is:** Maestro works against a registered Git repository.

**How to use it:**
- Click **Open** in the rail → pick a Git repo folder.
- Switch between registered repos with the dropdown.
- Registered repos persist across restarts (stored in SQLite).

**Talking point:** A repo is the unit everything hangs off — its branches populate the "base branch" pickers, and its worktrees live under `~/.maestro/workspaces/<repo>/`.

---

## 4. Accounts & agent login (Settings)

**What it is:** Maestro drives each agent through its **own CLI login** — your subscription stays with the provider; no tokens are stored in Maestro.

**How to use it:**
1. Open **Settings** (gear, or `⌘/Ctrl + ,`).
2. Under **Accounts**, each agent (Claude Code, Codex, Cursor) shows install + login status.
3. Click **Log in** → an embedded terminal runs the CLI's real login flow (may open your browser for OAuth). The pane closes when the CLI reports success.
4. **Advanced** (per agent): store a headless/CI token (e.g. `claude setup-token` OAuth token, or an API key) — encrypted, write-only, never read back.

**Talking point:** Rather than reimplementing auth, Maestro shells out to each vendor's CLI and lets *it* own credentials (OS keychain / dotfiles). The login terminal is a real pty streamed over IPC. Claude Code is the primary supported agent today; Codex/Cursor are wired in progressively.

Also in Settings: **Repository test command** and the **Model pricing** editor (covered in §11 and §10.7).

---

## 5. Workspaces — the single-agent workbench

A **Workspace** = one branch + one isolated Git worktree + one agent, with a lifecycle: idle → running → awaiting_input → done (or error).

### 5.1 Create a workspace
**How to use it:** `⌘/Ctrl + N` (or **New workspace**). Enter a **name**, pick a **base branch**, choose the **agent** (Claude Code). Maestro creates a fresh worktree branched from that base.

**Talking point:** Creation runs `git worktree add` off the current base HEAD, so the agent starts from a clean, isolated checkout — no stashing, no branch-switching in your main clone.

### 5.2 Chat / run an agent turn
**How to use it:** In the **Chat** tab (`⌘1`), type a task and press **Enter** to send (**Shift+Enter** for a newline). The agent runs; its turn streams in as assistant text, tool calls, and tool results.
- **Cancel** stops a running agent mid-turn.

**Talking point:** Agent progress arrives as normalized push events over IPC — the renderer appends them to a per-workspace transcript. The event stream is the same shape regardless of which CLI produced it (a Harness abstraction normalizes each vendor's raw JSON).

### 5.3 Queue & task chaining
**How to use it:** While an agent is running, typing and pressing the **queue** button lines up a follow-up that runs when the workspace is free. You can also set **"depends on"** another workspace so a job waits for a *different* workspace to finish — that's cross-worktree pipelining.

**Talking point:** One queue shape covers both "several tasks on the same workspace, one at a time" and "a task that waits on another agent" — FIFO, dependency-aware.

### 5.4 Diff review (Monaco)
**How to use it:** The **Diff** tab (`⌘2`) shows the worktree's diff versus its base branch in a Monaco editor. It refreshes after each agent turn.

**Talking point:** This is the human-in-the-loop gate — nothing merges until you've seen the diff. Same editor engine as VS Code.

### 5.5 Integrated terminal
**How to use it:** The **Terminal** tab (`⌘3`) is a real shell running **inside the worktree** (via `node-pty`). It persists across tab switches.

**Talking point:** Because it's cwd'd into the isolated worktree, you can run builds/commands against exactly what the agent produced without touching your main checkout.

### 5.6 Tests
**How to use it:** Set a **test command** per repo (Settings → Repository). Then **Run tests** (`⌘/Ctrl + Enter`) executes it inside the worktree and shows a pass/fail badge.

**Talking point:** Tests run against the agent's isolated worktree, so a green check means *that* variant passes — critical for the fan-out comparison below.

### 5.7 Review bar — commit / merge / PR
**What it is:** The bar above the tabs turns an approved diff into a merge or PR.

**How to use it:**
- Shows **changed-file count** and whether there are **uncommitted** changes.
- **Merge → base**: commits and merges the worktree into its base branch. Toggle **"Archive after merge"** to clean up the worktree afterward.
- **Create PR**: pushes the branch and opens a PR via the GitHub CLI (`gh`) — button is disabled unless `gh` is installed and authenticated.
- **Merge conflicts** are surfaced explicitly: the merge is aborted (nothing changed) and the exact conflicted files are listed.
- A **History** list records past merges and PRs (with clickable PR links).

**Talking point:** Merge conflicts abort cleanly and report the files rather than leaving a half-merged mess — the engine treats a conflict as an expected outcome, not a crash.

### 5.8 Archive
**How to use it:** **Archive** removes the worktree and archives the workspace (keeps history). Use it to clean up when done.

---

## 6. Fan-out — competing variants

**What it is:** Run **one task as 2–5 variants in parallel**, each in its own worktree, then keep the winner.

**How to use it:**
1. `⌘/Ctrl + ⇧ + N` (or the fan-out button).
2. Enter a **task name**, **base branch**, and the **shared prompt**.
3. Add **2–5 variants** (optionally set a different **model** per variant).
4. Launch — Maestro creates a worktree per variant and starts them all. They appear **grouped** in the sidebar.

**The Compare tab (`⌘4`, only for grouped workspaces):** side-by-side of every variant — status, changed-file count, latest agent message, and test result — so you can judge them at a glance. **Open full diff** drills into one. **Keep this** archives the other variants and keeps the winner.

**Talking point:** Fan-out is a first-class pattern for "try N approaches, pick the best" — isolation via worktrees is what makes running them simultaneously safe. Tests + diff counts per variant turn "pick the winner" into an evidence-based decision.

---

## 7. Workflows — the Task Dependency DAG Scheduler

**What it is:** Define tasks with dependencies (a directed acyclic graph). Tasks whose dependencies are all **merged** auto-spawn agents. It's parallel orchestration with a human approval gate at every node.

### 7.1 Build a workflow
**How to use it:** Workflows view → **New workflow** opens the full-screen **builder**:
- Add tasks; each has a **title** and a **prompt**.
- **Drag from one node's handle to another** to create a dependency edge (`dependsOn`).
- Edit titles/prompts inline.
- Set the **base branch** and **max concurrency** (cap on simultaneous agents).
- **Cycle detection is live** — if you draw a cycle, the offending edge is flagged and save is blocked.
- **Two bundled templates**: "Feature + tests + docs" (a 3-task chain) and "Parallel refactor" (a diamond).

**Talking point:** Cycle detection uses Kahn's algorithm (topological sort). It runs live in the builder *and* on save in the main process — the UI gives fast feedback, the engine is the source of truth.

### 7.2 Run it & read the graph
**How to use it:** Open a workflow and press **Start**. Nodes are color-coded by status:
- **gray** = blocked (waiting on dependencies)
- **blue** = ready (deps met, queued)
- **amber (pulsing)** = running
- **purple** = completed (awaiting your diff review)
- **green** = merged
- **red** = rejected / failed
- **strikethrough gray** = cancelled

Edges show dependency direction; layout is auto-arranged top-to-bottom.

**Talking point:** A task becomes "ready" only when **every** parent is **merged** — not merely completed. And each agent's worktree is branched from the **current** base at spawn time, so a child actually sees its parents' merged changes. That ordering guarantee is the whole point of the DAG.

### 7.3 Inspect & act on a node
**How to use it:** Click a node to open the **inspector**: prompt, status, timing, linked workspace, and status-appropriate actions — **Approve** (merge), **Reject**, **Retry**.

### 7.4 Approve → serial merge
**How to use it:** Approving a completed task merges its diff into the base, then releases its children.

**Talking point:** Merges are processed **serially through a merge queue** — never two simultaneous merges into the base branch. If the base advanced while an agent was running, its worktree is **rebased onto the latest base before you review the diff**; a "base advanced" badge warns you in the meantime.

### 7.5 Rejection cascade
**How to use it:** Reject a node → a **confirmation dialog** lists **exactly which downstream tasks** will be cancelled. You choose:
- **Reject & cascade** — cancels all transitive children, or
- **Reject & retry** — re-queues the same task (optionally with an **edited prompt**) instead of cascading.

**Talking point:** The cascade set is computed by the engine (`previewCascade`) and shown *before* anything is cancelled — destructive actions are always previewed. Failures (agent crash) differ from rejections: children stay **blocked** (retryable), not cancelled.

### 7.6 Conflicts, pause/resume, restart
- If a task's rebase or merge **conflicts**, it enters a conflict sub-state (badge on the node), keeps its worktree alive for manual resolution, and **blocks the merge queue** so nothing merges past it until resolved.
- **Pause** stops new spawns but lets running agents finish; **Resume** continues.
- On **app restart**, workflow/task state is persisted; agents that were mid-run are marked interrupted and can be retried — the rest of the graph is intact.

**Talking point:** All scheduling logic lives in the **main process**; the renderer only reflects state via push events. That separation is what makes restart-recovery and serial merging reliable.

---

## 8. The Cost & Token Dashboard (the "Cost" tab)

**What it is:** Real-time per-agent and aggregate visibility into token usage and estimated cost, with history that survives restarts.

> The dashboard is empty until an agent actually runs — by design it **never shows false $0s**. To demo it live, run a real agent turn (or a workflow) first, then switch to the Cost tab.

### 8.1 Live tiles (top row)
- **Session cost** — total USD this session.
- **Session tokens** — total tokens this session.
- **Burn rate** — tokens/min over the trailing 5 minutes.
- **Active agents** — how many are running right now (pulses when > 0).

### 8.2 Cumulative cost chart
A recharts area chart of **cumulative cost over the session, stacked by agent** — each band is one agent's contribution. Live-updating.

### 8.3 Per-agent table
Sortable rows: agent name, model, tokens (in / out / cache), cost, live status, and duration. Running agents update live.

### 8.4 Per-workflow rollup
If workflows exist, cost grouped by workflow with a **per-task breakdown**.

### 8.5 History
All past usage grouped by day, with a **date-range filter** — date, agents, turns, tokens, cost per day. Survives restarts (SQLite).

### 8.6 Cost badges everywhere
Every agent row in the sidebar shows a small live **"$0.42 · 128k tok"** badge.

### 8.7 Model pricing editor (Settings)
Under Settings → **Model pricing**: edit per-model rates (USD per 1M tokens: input / output / cache-read / cache-write). Saved to an override file.

**Talking points (this is your engineering showcase):**
- **Cost is always best-effort and honest:** the agent CLI's own reported cost wins when present; otherwise it's computed from the pricing table via longest-prefix model matching; if the model is unknown and there's no CLI cost, it's flagged **"unavailable"** rather than shown as $0.
- **Live updates are throttled to ≤1/second** — the dashboard reads a snapshot of the store on a 1s tick, so rapid usage pushes never thrash React.
- **Cost math is a single shared, unit-tested module** (`shared/cost.ts` + `shared/usage.ts`) used by both the main process (rollups over IPC) and the renderer (client-side per-event pricing), so every number reconciles across tiles, chart, table, and rollup.
- **Session boundary comes from the main process** (not renderer time), so persisted history is cleanly separated from "this session."

---

## 9. Keyboard shortcuts

Press **`?`** anytime for the cheat-sheet. The full set:

| Keys | Action |
| --- | --- |
| `⌘/Ctrl + N` | New workspace |
| `⌘/Ctrl + ⇧ + N` | Fan out a task |
| `⌘/Ctrl + ,` | Settings & accounts |
| `⌘/Ctrl + 1..4` | Chat / Diff / Terminal / Compare tabs |
| `⌘/Ctrl + Enter` | Run tests for the selected workspace |
| `Enter` | Send prompt (in the composer) |
| `⇧ + Enter` | New line (in the composer) |
| `Esc` | Close a dialog |
| `?` | This cheat-sheet |

---

## 10. Under-the-hood talking points (for a technical audience)

Sprinkle these in to show depth:

- **Strict main/renderer separation.** All business logic and state transitions live in the main process; the renderer renders and dispatches intents. No scheduling logic in React components.
- **Typed IPC with runtime validation.** Every channel has a Zod schema; the preload is a thin, dependency-free bridge suitable for `sandbox: true`. The renderer re-validates push events and parses structured errors back out of rejected invokes.
- **Git worktree isolation.** Each agent/task/variant is a separate worktree branched from a base — the mechanism that makes safe parallelism possible.
- **Serial merge queue + fresh-base spawning.** Never two merges into the base at once; children spawn from the latest base so they see merged parent work.
- **Harness abstraction.** Each vendor CLI (Claude Code, Codex, …) is normalized into one `AgentEvent` stream, so the rest of the app is vendor-agnostic. Usage/cost is pulled from the normalized `turn_complete.usage` (the CLI's own structured stream), not guessed.
- **Persistence & recovery.** SQLite via `better-sqlite3` holds repos, workspaces, review history, workflows, and usage events — the app recovers cleanly after a restart.
- **Tested.** Pure logic (DAG scheduler, cost/usage math) has vitest unit tests; each module ships a headless `smoke:mNN` acceptance script that runs the real engine against a fake agent harness.

---

## 11. Suggested Storyboard (record in this order)

A ~5–7 minute flow that tells a complete story:

1. **Intro (30s).** Say the pitch from §0. Show the three-view switcher.
2. **Setup (30s).** Open a repo; open Settings → show Accounts (logged in) and set a test command.
3. **Single agent (90s).** `⌘N` → create a workspace → send a small task (e.g. "add a health-check endpoint"). Narrate the streaming turn. Switch to **Diff** to show the change, **Terminal** to run something, then **Run tests** (`⌘↵`) for a green badge.
4. **Review (45s).** In the review bar, point out changed-file count → **Merge → base** with "archive after merge". Mention conflict handling and PR creation.
5. **Fan-out (75s).** `⌘⇧N` → same prompt, 3 variants → launch. Open the **Compare** tab, walk the side-by-side, **Keep this** on the winner.
6. **Workflows (2 min).** New workflow → load the **diamond template** (or build one, dragging an edge; try drawing a cycle to show it's blocked). **Start** it. Narrate node colors as tasks run. Open the inspector, **Approve** a node (mention serial merge + fresh base). **Reject** one node to trigger the **cascade dialog**; show "reject & retry with edited prompt".
7. **Cost dashboard (90s).** Switch to **Cost**. Point at the live tiles, the stacked cumulative chart, the sortable per-agent table, and the per-workflow rollup. Open **Settings → Model pricing** to show editable rates. Call out "CLI cost wins, unknown models flagged, never a false $0."
8. **Close (30s).** Recap the architecture points from §10: main/renderer split, worktree isolation, typed IPC, serial merge queue, tested. Done.

---

### Quick reference — where things live in the code (for Q&A)

- Scheduler engine: `src/main/engine/scheduler/` (`dag.ts`, `WorkflowScheduler.ts`, `TaskRunner.ts`)
- Worktrees & git: `src/main/engine/WorktreeManager.ts`, `GitService.ts`
- Usage/cost pipeline: `src/main/engine/store/UsageEventStore.ts`, `pricing.ts`; shared math in `shared/cost.ts`, `shared/usage.ts`
- Agent harnesses: `src/main/harness/`
- IPC contract: `shared/ipc.ts` (channels + typed API), validated with `shared/types.ts`
- Dashboard UI: `src/renderer/components/dashboard/`
- Workflow UI: `src/renderer/components/workflow/`
- Acceptance smokes: `scripts/moduleNN-smoke.ts` (`npm run smoke:m12` … `smoke:m14`)
