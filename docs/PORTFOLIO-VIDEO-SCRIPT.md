# Maestro — Portfolio Video Script (3–4 min)

**Format:** screen recording + voiceover. **Tone:** confident, plain-spoken, first-person ("I built…"). **Target:** ~3:45. **Spoken words:** ~360 (the rest is action/pauses).

Read the **Say** column aloud; do the **Do** column on screen. Lines are written to be read at a natural pace — don't rush.

---

## ⚙️ Before you hit record (do this first — it makes or breaks the take)

- [ ] **Log in to Claude Code** (Settings → Accounts) so agents actually run.
- [ ] **Open a repo that lives OUTSIDE OneDrive** (OneDrive corrupts `.git` objects → worktree errors). Clone a small demo repo to e.g. `C:\dev\demo`.
- [ ] **Set a test command** for that repo (Settings → Repository) so the green test badge shows.
- [ ] **Pre-build one workflow** with **concrete prompts** (not the template placeholders — those make the agent no-op). Example prompts that reliably produce a diff:
  - `Create FEATURE.md at the repo root with a short paragraph describing a login feature.`
  - `Add a /health route returning {status:"ok"} and a test for it.`
- [ ] **Pre-run at least one agent (or the whole workflow) once** so the **Cost dashboard has data** — it's intentionally empty until agents spend tokens.
- [ ] Set window to a clean size, hide personal info, close other apps. Do a 20-second dry run.

> Pro move: record each section as its own clip, then stitch. If an agent takes a while, speed up (2×) the waiting parts in editing.

---

## 🎬 The script

| Time | Do (on screen) | Say (voiceover) |
|------|----------------|-----------------|
| **0:00–0:18** — Hook | App open on the Workspaces view. Slowly show the sidebar's three tabs (Workspaces / Workflows / Cost). | "This is **Maestro** — a desktop app I built for orchestrating multiple AI coding agents **in parallel**. Every agent runs in its own isolated Git worktree, so they never step on each other. Let me show you." |
| **0:18–1:00** — One agent, end to end | `⌘N` → create a workspace. Type a concrete prompt, hit Enter. Let the turn stream. Switch to the **Diff** tab. Then click **Merge → main**. | "I point it at a Git repo and give an agent a task. It spins up a **dedicated worktree**, runs the agent, and streams the work back live. When it's done, I review the **actual diff** in a Monaco editor — nothing merges until I've seen it. One click **commits and merges** into the base branch. Conflicts get detected and aborted safely, or I can open a GitHub PR instead." |
| **1:00–1:45** — Fan-out variants | `⌘⇧N` → one prompt, **3 variants** → launch. Show them grouped in the sidebar. Open the **Compare** tab. Click **Keep this** on the best one. | "The real power is running the **same task as competing variants**. I describe it once, fan it out to three agents, each in its own worktree, all at the same time. This **compare view** puts them side by side — status, files changed, test results — so I pick the winner on **evidence**, not vibes. Keep this one, archive the rest." |
| **1:45–2:55** — Workflows (the centerpiece) | Switch to **Workflows**. Briefly show the graph (nodes + edges). Click **Start**. Narrate as node colors change. Click a completed (purple) node → **Approve**. Then click another node → **Reject** → show the **cascade dialog**. | "Now the centerpiece — **dependency workflows**. I define tasks as a graph: this one depends on that one. Maestro checks it's acyclic, then schedules it. Tasks whose dependencies are all merged **auto-spawn agents**, up to a concurrency limit. Watch the nodes — gray is blocked, **amber is running**, purple means done and waiting for my review, **green is merged**. I approve a node and it merges — and because each agent branches from the **latest** base, downstream tasks actually see their parents' merged work. If I reject a node, it shows me **exactly which downstream tasks it'll cancel** before touching anything — or I retry it with an edited prompt. And merges run **serially through a queue**, so two agents never merge at once." |
| **2:55–3:30** — Cost dashboard | Switch to the **Cost** tab. Point at the tiles, the cost-over-time chart, the per-agent table. Briefly open **Settings → Model pricing**. | "Everything the agents spend is tracked **live** — session cost, token burn rate, active agents, a cost-over-time chart broken down per agent, and a sortable table. It uses each CLI's **own reported cost** when available, and it **never shows a fake zero** when a price is unknown. History survives restarts, and the rates are editable." |
| **3:30–3:50** — Tech close | Slowly pan the graph or dashboard as a backdrop. Optional: flash the code tree for a second. | "Under the hood, an **Electron main process** owns all the state — scheduling, Git worktrees, SQLite — and a **React** front end that just renders it, over a fully **type-checked, schema-validated IPC** layer. It's tested with unit and end-to-end acceptance scripts. That's **Maestro** — thanks for watching." |

---

## ✂️ Trim to 3:00
Cut the **fan-out** section (1:00–1:45). The story still lands: one agent → workflows → cost.

## ➕ Extend to 4:00
After the workflow approve, add ~20s: open the **terminal tab** inside a worktree and run the test command, or show the **conflict handling** by rejecting-and-retrying with an edited prompt (great "human-in-the-loop" beat).

---

## 🗣️ Delivery tips
- Pause after each feature name ("dependency workflows.") — let the visual breathe.
- Say numbers when you can ("three agents," "runs serially") — specifics sound credible.
- End sentences down, not up. Confidence.
- If an agent errors on camera (e.g. a vague prompt → nothing to merge), **cut it** — always demo with concrete prompts that produce a real diff.

## 🔑 One-line elevator pitch (for the video title / description)
> Maestro: a desktop app that runs multiple AI coding agents in parallel — isolated Git worktrees, a dependency-graph scheduler with human approval at every merge, and live token-cost tracking. Built with Electron, React, TypeScript, and SQLite.
