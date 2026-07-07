# Maestro — Feature Implementation Spec
## Task Dependency DAG Scheduler + Live Cost/Token Dashboard

> **How to use this document:** Paste each phase into Claude Code as a separate session/task. Start every phase in **plan mode** (`shift+tab`) so Claude proposes an approach before touching code. Do NOT paste the entire doc at once — phases build on each other and each should end with a working, committed state.

---

## Context (paste this at the top of every Claude Code session)

You are working on **Maestro**, an Electron desktop app that orchestrates multiple Claude Code agents running in parallel, each in an isolated Git worktree.

**Stack:**
- Electron (main process handles agent lifecycle, worktree management, IPC)
- React + TypeScript (renderer)
- Zustand for state management
- Monaco editor for diff review
- Git worktrees for agent isolation — each agent gets its own worktree branched from main
- Agents are Claude Code CLI processes spawned and managed by the main process

**Existing core concepts:**
- `Agent`: a spawned Claude Code process with a task prompt, a dedicated worktree, and a lifecycle (idle → running → completed → reviewing → merged/rejected)
- `Worktree`: created per-agent, cleaned up after merge/reject
- Diff review: when an agent completes, its worktree diff vs base branch is shown in Monaco; user approves (merge) or rejects (discard)

**Before writing any code:** explore the existing codebase structure first. Read the agent lifecycle manager, the Zustand store shape, and the IPC channel definitions. Match existing patterns and naming conventions — do not introduce new architectural styles.

---

# FEATURE 1: Task Dependency DAG Scheduler

## Goal
Users can define tasks with dependencies (a DAG). Tasks whose dependencies are all satisfied auto-spawn agents. A task's dependencies are satisfied only when every parent task's diff has been **approved and merged** — not merely completed.

## Data model

```typescript
type TaskStatus =
  | 'blocked'      // waiting on unmet dependencies
  | 'ready'        // deps met, queued to spawn
  | 'running'      // agent active
  | 'completed'    // agent done, awaiting diff review
  | 'merged'       // diff approved, merged to base
  | 'rejected'     // diff rejected by user
  | 'cancelled'    // cancelled by cascade or user
  | 'failed';      // agent crashed / errored

interface Task {
  id: string;
  title: string;
  prompt: string;              // the prompt given to the Claude Code agent
  dependsOn: string[];         // task IDs — parents that must be MERGED first
  status: TaskStatus;
  agentId?: string;            // linked agent once spawned
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  failureReason?: string;
}

interface Workflow {
  id: string;
  name: string;
  tasks: Task[];
  baseBranch: string;          // branch all worktrees fork from / merge into
  status: 'draft' | 'running' | 'paused' | 'completed' | 'failed';
  maxConcurrency: number;      // cap on simultaneous agents (default 3)
}
```

## Scheduler rules (implement exactly)

1. **Validation on save:** reject workflows containing cycles. Detect via topological sort (Kahn's algorithm). Show which tasks form the cycle in the error message.
2. **Ready condition:** a task becomes `ready` when ALL tasks in `dependsOn` have status `merged`.
3. **Concurrency:** never exceed `maxConcurrency` running agents. When a slot frees, spawn the oldest `ready` task (FIFO by createdAt).
4. **Fresh base per spawn:** each agent's worktree must branch from the CURRENT state of `baseBranch` at spawn time — so a dependent task sees its parents' merged changes. This is the entire point of dependency ordering. Verify this explicitly in the worktree creation call.
5. **Rejection cascade:** if a task's diff is rejected, all downstream tasks (transitive children) move to `cancelled`. Show a confirmation dialog first, listing exactly which tasks will be cancelled. Offer "Reject & retry" which re-queues the same task with an optional edited prompt instead of cascading.
6. **Failure handling:** if an agent crashes (`failed`), downstream tasks stay `blocked` (not cancelled). User can retry the failed task. After 1 automatic retry attempt, require manual retry.
7. **Independent subgraphs are unaffected** by failures/rejections in other subgraphs — only descendants are impacted.
8. **Pause/resume:** pausing a workflow prevents new spawns but lets running agents finish.

## Edge cases to handle (write tests for each)

- Diamond dependency: A → B, A → C, B → D, C → D. D spawns only after BOTH B and C merge. D's worktree must contain both B's and C's changes.
- Parent merged, then a sibling's merge creates conflicts with a `ready` (not yet spawned) task — acceptable, agent deals with current base state. But if a RUNNING agent's worktree becomes stale (base advanced since spawn), surface a "base advanced" warning badge on that agent; on completion, rebase the worktree onto latest base before showing the diff. If rebase conflicts, show conflict state in UI and pause the merge (do not auto-resolve in this phase).
- Merging two sibling tasks that both touch the same file: second merge may conflict. Detect merge failure, set task to a `merge-conflict` sub-state, keep the worktree alive for manual resolution, and block the merge queue until resolved. Merges must be processed SERIALLY through a merge queue — never two simultaneous merges into baseBranch.
- App restart mid-workflow: persist workflow + task state (Zustand persist or file-based in main process). On restart, running agents are gone — mark previously-`running` tasks as `failed` with reason "interrupted", keep the rest of the graph intact, allow retry.
- User deletes a task that has children: warn and re-parent or cancel children (ask user).

## UI requirements

- **Graph view:** render the DAG visually. Use `@xyflow/react` (React Flow) — nodes colored by status (blocked=gray, ready=blue, running=amber pulse, completed=purple, merged=green, rejected/failed=red, cancelled=strikethrough gray). Edges show dependency direction. Auto-layout with `dagre` or ELK.
- Clicking a node opens a side panel: prompt, status, linked agent logs, timing, retry/cancel buttons.
- **Builder mode:** add tasks, draw dependency edges by dragging between nodes, edit prompts inline. Validate for cycles live (highlight offending edge red, block save).
- **Workflow templates:** save/load workflow definitions as JSON to disk. Ship 2 example templates: "Feature + tests + docs" (3-task chain) and "Parallel refactor" (diamond).
- Keep ALL scheduling logic in the main process; renderer only reflects state via IPC events. Do not put scheduler logic in React components.

## Phases (separate Claude Code sessions)

**Phase 1.1 — Core scheduler engine (main process, no UI)**
- Task/Workflow types, cycle detection, topological readiness computation, concurrency-capped spawn loop, merge queue (serial merges), state persistence, IPC events for state changes.
- Unit tests: cycle detection, diamond dependency ordering, rejection cascade set computation, concurrency cap, FIFO ordering. Use the existing test setup; if none exists, add vitest for main-process logic.
- Acceptance: can run a scripted 4-task diamond workflow headlessly (via a dev script) with mock agents (a fake agent that sleeps then writes a file) and observe correct ordering + merges.

**Phase 1.2 — Wire to real agents + rebase/conflict handling**
- Replace mock agents with real agent spawn calls. Fresh-base worktree creation, stale-base detection, rebase-on-complete, merge-conflict sub-state.
- Acceptance: run a real 3-task chain on a sample repo; task 2's agent can see task 1's merged changes.

**Phase 1.3 — Graph UI**
- React Flow DAG view, builder mode, node side panel, cascade confirmation dialogs, templates.
- Acceptance: build a diamond workflow entirely from the UI, run it, reject one node, verify cascade dialog and visual states.

---

# FEATURE 2: Live Cost & Token Dashboard

## Goal
Real-time per-agent and aggregate visibility into token usage and estimated cost, with historical persistence across sessions.

## Data collection

- Claude Code emits usage data — parse it from the agent process output. Investigate the best available source in order of preference: (1) structured JSON output if the CLI is run with a JSON output flag, (2) the session transcript files Claude Code writes to `~/.claude/projects/` (JSONL — each entry can contain a `usage` object with input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens), (3) parsing stdout as a fallback. Explore what Maestro currently captures from agent processes and choose the most reliable source. Do NOT guess token counts.
- Store per-agent usage samples as time-series events:

```typescript
interface UsageEvent {
  agentId: string;
  taskId?: string;
  workflowId?: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model: string;             // pull from the transcript/output, don't hardcode
}
```

- **Pricing table:** keep model pricing in a single editable JSON config (`pricing.json`) with per-model input/output/cache rates. Do NOT hardcode prices in components. Include a settings UI field to edit rates, since prices change. Seed with current published Anthropic API rates and mark the file with a "last verified" date.
- Persist usage history to disk (SQLite via `better-sqlite3` in the main process is preferred; a JSONL append log is acceptable if SQLite adds too much complexity). Must survive app restarts.

## Dashboard UI

New "Dashboard" view with:

1. **Live tiles (top row):** total cost this session, total tokens this session, current burn rate (tokens/min over trailing 5 min), active agent count.
2. **Per-agent table:** agent name/task, model, input/output/cache tokens, cost, status, duration. Sortable. Running agents update live (throttle UI updates to max 1/sec).
3. **Time-series chart:** cumulative cost over time for the session, stacked by agent. Use `recharts`. Live-updating.
4. **Per-workflow rollup:** if Feature 1 is present, group costs by workflow with per-task breakdown.
5. **History view:** past sessions/workflows with date, total cost, tokens, task count. Simple date-range filter.
6. Every agent card elsewhere in the app gets a small live cost badge (e.g., "$0.42 · 128k tok").

## Edge cases

- Usage source unavailable/unparseable → show "usage unavailable" for that agent rather than $0.00 (never display false zeros as if accurate).
- Cache read tokens priced differently from input tokens — respect the pricing table's cache rates.
- Multiple models across agents in one session — cost math must be per-event using that event's model rate.
- Clock: use monotonic-ish timestamps from main process only; don't trust renderer time.

## Phases

**Phase 2.1 — Collection pipeline**
- Investigate + implement the usage data source, UsageEvent emission over IPC, SQLite persistence, pricing config.
- Acceptance: run one agent, verify UsageEvents land in DB with sane numbers matching the transcript.

**Phase 2.2 — Dashboard UI**
- Tiles, per-agent table, recharts time-series, history view, cost badges.
- Acceptance: run 3 agents in parallel, watch live updates, restart app, verify history persists.

---

# Global constraints (include in every session)

- TypeScript strict mode; no `any` unless unavoidable and commented.
- All new IPC channels follow the existing channel naming convention in the codebase.
- No scheduling/business logic in React components — main process owns state transitions, renderer renders.
- Every phase ends with: typecheck passing, lint passing, existing tests passing, new tests for new logic, and a conventional commit.
- Update the README feature list only in the final phase.
- If a design decision isn't specified here, propose 2 options with tradeoffs and ask before implementing.

# Suggested session order

1. Phase 1.1 (scheduler core) — biggest and riskiest, do first
2. Phase 2.1 (usage pipeline) — independent, can even run while reviewing 1.1
3. Phase 1.2 (real agents + rebase)
4. Phase 1.3 (graph UI)
5. Phase 2.2 (dashboard UI)
6. Final: README + demo GIFs + release cut

---

## Progress log

- **Phase 1.1 — Core scheduler engine — ✅ DONE.** Shipped as Maestro "Module 12" (renumbered from Module 9 to avoid a numbering collision with the mainline's fan-out module during the rebase/merge onto `origin/main`). Includes: `shared/types.ts` workflow/task schemas, `src/main/engine/scheduler/dag.ts` (Kahn cycle detection + readiness), `src/main/engine/scheduler/WorkflowScheduler.ts` (concurrency-capped spawn loop, serial merge queue, rejection cascade, auto-retry, restart recovery), `src/main/engine/store/WorkflowStore.ts` (persistence), IPC wiring, and vitest unit tests + `scripts/module12-smoke.ts` (headless diamond acceptance). Uses a mock task runner; real agents arrive in Phase 1.2.
- **Phase 2.1 — Usage/cost collection pipeline — ✅ DONE.** Shipped as Maestro "Module 13". Usage source: the harness's normalized `turn_complete.usage` (Claude Code's `--output-format stream-json` result message: per-turn tokens + `total_cost_usd` + model, already mapped by `ClaudeStreamMapper`; Codex mapped equivalently) — chosen over transcript-file parsing because Maestro already captures the structured stream. Includes: `UsageEvent`/`UsageSummary`/`PricingTable` schemas + `usage_recorded` push event (`shared/types.ts`), SQLite `usage_events` table (`Database.ts`), `UsageEventStore` (append-only persistence), `pricing.ts` (built-in rates + user-editable `<home>/.maestro/pricing.json` override seeded from `config/pricing.json`, longest-prefix model matching, per-event cost math preferring the CLI's own reported cost, never a false $0 — unknown costs flag `costComplete: false`), supervisor capture hook (`WorkspaceSupervisor.recordUsage`), `maestro:usage:list` + `maestro:usage:summary` IPC across all four layers, vitest unit tests (`pricing.test.ts`), and `scripts/module13-smoke.ts` (fake-harness end-to-end acceptance: rows persisted with exact numbers, push events broadcast, filtering, cost math, restart persistence). Dashboard UI arrives in Phase 2.2; `taskId`/`workflowId` columns are reserved for its per-workflow rollup.
- **Phase 1.2 — Real agents + rebase/conflict handling — ✅ core landed.** Scheduler-side rebase-on-complete and merge-conflict handling. Includes: `TaskRunner.prepareForReview()` + `ReviewPrep` type (rebase a completed task's worktree onto the advanced base before its diff is reviewed; returns conflict files rather than throwing); scheduler `prepareReview` runs it in the background off the completion event and records a `{kind:'rebase'}` conflict sub-state on failure; `approveTask` awaits the in-flight prep, retries the rebase once (resolve-and-retry: the user may have fixed the worktree manually), and on a merge conflict records `{kind:'merge'}`, blocks the repo's merge queue (`mergeBlocks`) so no OTHER task can merge past it, and rethrows; rejecting/retrying the blocker releases the queue; `recover()` re-derives the block from the persisted `conflict` field on restart; `onBaseAdvanced` hook → main-process `notifyStaleRunning` pushes `base_advanced` badge events to still-running siblings whose worktrees fell behind, reflected in the renderer store's `baseAdvanced` map (cleared on any status change). Vitest coverage added for all four new scheduler behaviors (rebase-conflict-blocks-merge + resolve-and-retry, merge-conflict blocks the queue for other tasks, reject releases the queue, restart re-derives the block); typecheck + 52 tests + `smoke:m12` green. **Still pending:** a real end-to-end acceptance run (3-task chain against a live Claude Code agent verifying task 2 sees task 1's merged changes) per the phase's acceptance criteria — the `notifyStaleRunning` / `base_advanced` glue and the real rebase path are exercised only by unit-level fakes so far.
- **Phase 1.3 — Graph UI — ✅ core landed.** React Flow DAG view + builder for the scheduler. Adds `@xyflow/react` + `dagre`. New renderer pieces: `components/workflow/dag.ts` (dagre top-to-bottom auto-layout, Kahn cycle detection for live builder validation, status→token color map matching the design system), `WorkflowGraph` (read-only run graph, custom `TaskNode` colored by status with running-pulse / cancelled-strikethrough / conflict badge), `TaskInspector` (prompt, timing, linked workspace, and status-appropriate approve/resolve-&-approve/reject/retry actions), `WorkflowBuilder` (full-screen editable canvas: add tasks, drag handle-to-handle to wire `dependsOn`, inline title/prompt editing, live cycle rejection, base-branch/concurrency, and 2 bundled templates — "Feature + tests + docs" chain and "Parallel refactor" diamond — via `templates.ts`), and `CascadeDialog` (lists the exact descendants `previewCascade` would cancel; offers reject-&-cascade vs. reject-&-retry with an edited prompt). Store gains workflow state + actions + `onWorkflowEvent` subscription; the sidebar gets a Workspaces/Workflows switch and a workflow list; `App` renders `WorkflowView`. Typecheck + 52 tests + full `npm run build` green (React Flow CSS imported in `main.tsx`). **Still pending:** interactive acceptance run (build a diamond in the UI, run it, reject a node, watch the cascade dialog + live node colors) — not runnable headlessly here — and the README feature-list update, deferred to the final release phase per the global constraints.
- **Phase 2.2 — Dashboard UI — ✅ core landed.** Live cost/token dashboard for Module 13's usage pipeline. Shared cost math extracted to `shared/cost.ts` (pure, no `fs`) so the renderer prices events client-side; `src/main/engine/pricing.ts` re-exports it (existing tests unchanged) and adds `writePricing`. New pure `shared/usage.ts` holds the dashboard aggregations (per-agent/-workflow rollups, trailing-5-min burn rate, cumulative-cost series, money/token formatting) with `shared/usage.test.ts` (11 vitest cases; vitest `include` widened to `shared/**`). Three new IPC channels across all four layers: `getSessionStart` (main-authored "this session" boundary so persisted history is excluded), `getPricing`, and `setPricing` (writes the user override). Store gains `usageEvents`/`pricing`/`sessionStartedAt` + `refreshUsage`/`savePricing`, and the previously no-op `usage_recorded` push now mirrors samples into the live working set. New renderer view (`components/dashboard/`): `DashboardView` (throttles the store snapshot to ≤1/sec via `getState()` polling so fast pushes don't thrash render), `CostTiles` (session cost/tokens, burn rate, active agents), `CostOverTimeChart` (recharts stacked cumulative cost by agent), `AgentUsageTable` (sortable, live), `WorkflowRollup` (joins usage→workflow via `task.agentId`, since usage rows don't carry a workflow id), `HistoryView` (all-sessions, grouped by day, date-range filter), and a reusable `CostBadge` now shown on every sidebar agent row (spec item 6). Added a third "Cost" sidebar tab + a dashboard agent rail, a `chart` icon, and a collapsible model-pricing rates editor in Settings. Added deps `recharts` + `react-is`. Costs are always best-effort — the CLI's own reported cost wins, unknown models flag "unavailable" rather than a false $0. Typecheck + 63 tests + full `npm run build` green. **Acceptance:** `scripts/module14-smoke.ts` (`npm run smoke:m14`) runs the real engine + supervisor with a fake harness and THREE parallel agents, asserting the exact aggregations the dashboard renders — per-agent rollups, session-total/chart/tiles reconciliation, trailing-window burn rate, the "this session" boundary excluding prior-session history, the per-workflow (task.agentId) join, an edited-pricing round-trip through `writePricing`/`loadPricing`, and restart persistence with day-grouped history. **Still pending:** the purely-visual UI pass (open the Cost tab with 3 agents live, confirm tiles/table/recharts update ≤1/sec and the Settings rates editor saves) — not runnable headlessly — and the README feature-list update, deferred to the final release phase.
- **Next up:** the remaining live-UI/visual acceptance passes for Phase 1.2 (live 3-task chain), Phase 1.3 (build/run/reject a diamond in the UI), and Phase 2.2 (Cost tab visuals) — their engine/data paths are now covered by `smoke:m12`/`smoke:m13`/`smoke:m14` — then the final release phase (README + demo GIFs + release cut).
