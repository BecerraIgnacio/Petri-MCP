# petri-mcp roadmap

Two agents + applier + MCP shell are done. Below is what petri-mcp still needs to be the full pitch in CLAUDE.md ("90/10 traffic split, champions, 2^(n−3) backoff, phylogenetic dashboard"), grouped so each module fits in one session.

---

## What's done

- **Vibe Identifier** (Agent 1) — runtime LLM agent that scans a v0 project and emits a brand-lock manifest. `repo/src/agents/vibe-identifier/`. MCP tool `vibe_identifier`.
- **UX/UI Evolver** (Agent 2) — runtime LLM agent that produces N small lock-respecting variants for a target metric. `repo/src/agents/ux-ui-evolver/`. MCP tool `ux_ui_evolver`.
- **Lock validator** — mechanical, defense-in-depth. `repo/src/agents/ux-ui-evolver/validator.ts`.
- **Mutation applier** — 6 mutation kinds, cheerio + targeted CSS regex. `repo/src/shared/apply-mutations.ts`.
- **MCP server** — stdio, exposes both agent tools. `repo/src/server.ts`.
- **Demo** — Vibe → Evolver → applyMutations → 3 rendered HTML files, visually verified the lock holds. `scripts/build-demo.ts`.

---

## What's left

### M1 — Project state & persistence

A "petri project" is a long-lived thing: source HTML, lock manifest, current champion, variants in flight, lineage tree, metric counters. Needs a representation in code and somewhere on disk.

**Decisions:** SQLite (file-based, transactional, no service) vs. plain JSON files vs. Vercel KV. Schema for the lineage tree (parent variant id, generation number, win streak).

**Blocks everything else.**

---

### M2 — Variant serving

Variants live as HTML files; something has to *serve* them to real users. Three options: petri runs its own HTTP server per project / petri writes to Vercel KV + an edge function reads from there / petri proxies an upstream and rewrites responses.

**Decisions:** Self-hosted vs. Vercel-hosted. For Vercel Agent Hackathon, edge-function-on-Vercel is probably the right answer.

---

### M3 — Traffic split + sticky bucketing

Routes 90% to champion, 10% across variants. Sticky-per-user (cookie or IP hash) so the same user sees the same variant within a generation.

**Decisions:** Bucketing strategy. Whether the 10% split across N variants is uniform or Thompson-sampled (the project hub status row mentions Thompson sampling — that lives here, not in M5).

---

### M4 — Metric ingestion

Events flow back: page views, clicks, scroll depth, time-on-page, conversions. The variant-bucket cookie set in M3 attributes each event to a variant.

**Decisions:** Inline JS POSTing to a petri endpoint vs. server-log scraping. Schema for event types. Storage tier (M1 backs this).

---

### M5 — Promotion engine

Given metric data over a generation window, decide if a variant beat the champion. Maintains the win-streak counter + the 2^(n−3) backoff schedule from CLAUDE.md.

**Decisions:** Statistical test (chi-square / Bayesian) vs. naive lift-with-min-sample. Generation window definition (fixed time vs. fixed N impressions). Confidence threshold to promote.

---

### M6 — Generation orchestrator

The supervisor loop. For each project: trigger Vibe (once, or check cache) → trigger Evolver → apply mutations → deploy variants → wait → ingest metrics → call promotion engine → archive losers → repeat. Handles backoff state.

**Decisions:** Sync vs. async (cron-driven? webhook-driven?). Where the loop runs (a Vercel Cron Function? a long-running process? Vercel Workflow DevKit fits naturally here).

---

### M7 — High-level MCP surface for v0

What v0 actually calls. The current `vibe_identifier` / `ux_ui_evolver` tools are internals; v0 wants:

- `start_evolving(projectRoot, targetMetric, deployTarget)`
- `get_status(projectId)` → current gen, champion, variants in flight
- `get_champion(projectId)` → the winning HTML
- `pause_evolution` / `resume_evolution`
- `get_lineage(projectId)` → tree for the dashboard

**Decisions:** Which surface is "MCP-stable" vs. which we keep iterating.

---

### M8 — Phylogenetic dashboard

The visualization in the hackathon pitch — generation tree, champion lineage, metric history per branch. Static HTML page reading from M1, or a tiny Next.js app.

**Decisions:** Standalone or co-located with the variant-serving site.

---

### M9 — Docs

- `docs/ux-ui-evolver.md` (mirror of `docs/vibe-identifier.md`)
- `docs/apply-mutations.md` (the applier)
- `docs/architecture.md` (the system overview once M1–M7 settle)
- `README.md` update once `npm install && npm run start-evolving` actually works end-to-end

---

## Recommended order

**M1 → M2 → M3 → M4 → M5 → M6 → M7**, with **M8** and **M9** in parallel as you go. Each module roughly one session.

## Two strategic forks worth deciding before M2

1. **Are we Vercel-native or self-hosted?** Vercel-native unlocks Edge Config / KV / Cron / Workflow DevKit and matches the hackathon framing — at the cost of vendor coupling.
2. **For the hackathon demo specifically, do we need real traffic, or is synthetic enough?** A demo with simulated visitors clicking variants buys M3 + M4 + M5 a lot of breathing room.
