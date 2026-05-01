# Vibe Identifier

The Vibe Identifier is **Agent 1 of 2** in petri-mcp's evolution loop. It reads a v0 project on disk and emits a JSON manifest of the brand-defining elements that Agent 2 (UX/UI Evolver) is forbidden from mutating.

It is a runtime LLM agent — a system prompt, a set of tools, and a loop. It is **not** a Claude Code subagent.

---

## What it does

Given a path to a v0 project, the agent:

1. Explores the source files (HTML / JSX / TSX / CSS) using its tools.
2. Finds the **logo, key phrases, palette, fonts, and voice** that make the brand recognizably itself.
3. Emits a structured JSON manifest where every finding cites the file and line that proves it.
4. Produces a flat list of **`locked_selectors[]`** — `{ selector, scope, property, reason }` tuples — that the Evolver's mechanical validator uses to reject any variant whose diff overlaps the lock.

The agent does not mutate the project. It only identifies and locks.

---

## The contract

### Input

```ts
{
  projectRoot: string,           // absolute path to the project on the host fs
  hints?: {
    brand_name?: string,         // optional anchor for logo search
    site_type?:                  // weighs which key phrases qualify as taglines
      | "saas" | "news" | "ads"
      | "ecommerce" | "landing" | "other"
  }
}
```

### Output (success)

```ts
{
  status: "ok",
  brand_name: string,
  logo:        { type, value, selector, evidence, confidence },
  key_phrases: [{ text, kind, selector, evidence, confidence }, …],
  palette:     [{ role, hex, css_variable, evidence, confidence }, …],
  fonts:       [{ role, stack, evidence, confidence }, …],
  voice:       { tone: [...], vocabulary_signals: [...], forbidden_drift: [...] },
  locked_selectors: [{ selector, scope, property, reason }, …],   // ≥ 1, load-bearing
  notes?: string
}
```

`evidence` everywhere is `{ file, line, match }`. The schema is enforced by `zod` in [`src/agents/vibe-identifier/schema.ts`](../src/agents/vibe-identifier/schema.ts).

### Output (no recognizable brand)

```ts
{ status: "out_of_scope", reason: string }
```

---

## The locked_selectors contract

This is the field the Evolver actually reads. Every entry is a `(selector, scope, property)` triple plus a reason:

| field | meaning |
|---|---|
| `selector` | a CSS selector, or a `file:line` reference when CSS doesn't apply (e.g. JSX text content) |
| `scope` | the file path the selector applies in. `*` means global across all files. |
| `property` | the CSS property, OR a special token: `text-content`, `attr:src`, `attr:alt`, `element` (locks existence/structure). |
| `reason` | one short sentence explaining *what about the brand* this lock protects. |

**One finding produces many locks.** A primary color stored as a CSS variable produces:

- one lock on `:root` for the variable declaration,
- one lock on every selector that consumes the variable, keyed by the property it sets.

This granularity is what makes the constraint *invalid by mechanical diff* rather than *invalid by another LLM judging the variant*.

---

## How the loop works

The loop lives in [`src/agents/vibe-identifier/loop.ts`](../src/agents/vibe-identifier/loop.ts). It is hand-rolled — there is no AI SDK abstraction.

```
┌─ user message: "projectRoot=…, hints=…"
│
└─► step 0: chat.completions.create({ model, messages, tools })
      │     model picks a tool: glob, read_file, grep, or submit_findings
      │
      ├─► if exploration tool: run it, append result, loop
      └─► if submit_findings:  validate args against zod schema
                               ├─ valid:   return result, exit
                               └─ invalid: append error, let model retry
```

Up to **15 steps** by default (`MAX_STEPS` in `loop.ts`). The loop terminates **only** by a `submit_findings` tool call — not by free-text JSON in an assistant message. This is deliberate:

- **Deterministic exit.** No regex on prose, no `json_mode` flag, no prompt-engineering hoops.
- **Schema validation lives on the tool arguments.** Zod runs against the parsed JSON; if it fails, a `tool` message with the `issues[]` is fed back so the model can retry mid-loop.

If 15 steps elapse without a `submit_findings` call, the loop throws — this is a hard fail, not a fallback.

---

## The tools

Defined in [`src/agents/vibe-identifier/tools.ts`](../src/agents/vibe-identifier/tools.ts):

| tool | purpose |
|---|---|
| `glob(pattern)` | enumerate text files matching a glob. `node_modules`, `.git`, `dist`, `build` excluded. Returns ≤ 200 paths, filtered to known text extensions. |
| `read_file(path)` | read one file relative to `projectRoot`. Truncated to 200 KB. |
| `grep(pattern, pathGlob?, flags?)` | regex across text files. Returns up to 100 hits as `{ file, line, match }`. |
| `submit_findings(payload)` | terminal — exits the loop. Payload validated against the output schema. |

All paths are **resolved inside `projectRoot`**. Any path that escapes the root (via `..` or absolute paths) throws. This is enforced in `resolveInsideRoot()` regardless of what the model sends.

Tool results are clipped to 16 KB before being fed back to the model so a runaway grep can't blow the context.

---

## How to run it

### Standalone (debugging)

```bash
PETRI_DEBUG=1 ./node_modules/.bin/tsx scripts/run-vibe.ts test/fixtures/simplefit
```

`PETRI_DEBUG=1` writes step-by-step traces to **stderr** so the JSON on stdout stays parseable:

```
[vibe] step 0: calling moonshotai/kimi-k2-0905
[vibe] step 0: model returned in 3512ms
[vibe] step 0: 1 tool call(s) | content: I'll analyze the SimpleFit project to identify…
[vibe]   → glob({"pattern": "**/*"})
[vibe] step 1: …
```

### As an MCP tool

The agent is exposed by [`src/server.ts`](../src/server.ts) as the MCP tool **`vibe_identifier`** over stdio. Any MCP client can call it:

```json
{
  "name": "vibe_identifier",
  "arguments": {
    "projectRoot": "/abs/path/to/project",
    "hints": { "brand_name": "SimpleFit", "site_type": "landing" }
  }
}
```

The MCP response carries the validated JSON in both `content[0].text` and `structuredContent`.

### Under test

```bash
npm test
```

Runs `test/vibe-identifier.test.ts` against `test/fixtures/simplefit/`. The test makes a real OpenRouter call; it skips automatically when `OPENROUTER_API_KEY` is unset. Typical run: ~150 s of wall clock (most of it the final `submit_findings` step where the model emits the large JSON payload).

---

## Configuration

| env var | purpose | default |
|---|---|---|
| `OPENROUTER_API_KEY` | OpenRouter credentials | — (required) |
| `PETRI_MODEL` | OpenRouter model slug | `moonshotai/kimi-k2-0905` |
| `PETRI_DEBUG` | when `1`, emit step traces to stderr | off |

The model is non-thinking Kimi K2 (Sep 2025, 256 k context, native function calling). Any OpenAI-compatible model with tool support that OpenRouter exposes can be substituted via `PETRI_MODEL`.

---

## Failure modes

| condition | behavior |
|---|---|
| `OPENROUTER_API_KEY` missing | `getClient()` throws on first call. |
| Model returns no tool call | loop throws — this means the model went off-script. |
| `submit_findings` payload fails schema | tool result is `{ error, issues[] }`; loop continues so the model can retry. |
| 15 steps without `submit_findings` | loop throws `exhausted N steps`. |
| Tool tries to escape `projectRoot` | `resolveInsideRoot` throws; tool returns `{ error }` to the model. |
| Project has no recognizable brand | model is expected to call `submit_findings` with `{ status: "out_of_scope", reason }`. |

---

## Worked example: simplefit

Input:
```json
{ "projectRoot": "test/fixtures/simplefit", "hints": { "brand_name": "SimpleFit", "site_type": "landing" } }
```

Loop trace (abridged):
```
step 0  glob(**/*)                           → ["index.html"]
step 1  read_file(index.html)                → 18 KB of HTML+CSS+JS
step 2  grep(#[0-9a-f]{6}, *.html)           → palette hits incl. "--green: #22c55e"
step 3  grep(font-family, *.html)            → system font stack
step 4  grep(SimpleFit, *.html)              → wordmark in nav
step 5  grep(Get Fit in 20 Minutes…)         → H1 hit
step 6  grep(logo|Logo, *.html)              → .logo selector
step 7  grep(AI-powered|effortless|…)        → voice signals
step 8  submit_findings({ status: "ok", … }) → schema-valid → return
```

A subset of the output's lock list:

```json
[
  { "selector": ".logo",      "scope": "index.html", "property": "text-content", "reason": "Brand wordmark must remain SimpleFit" },
  { "selector": ".logo span", "scope": "index.html", "property": "color",        "reason": "Green accent in logo is brand-critical" },
  { "selector": ":root",      "scope": "index.html", "property": "--green",      "reason": "Primary brand color" },
  { "selector": "h1",         "scope": "index.html", "property": "text-content", "reason": "Main tagline is core brand messaging" },
  { "selector": "body",       "scope": "index.html", "property": "font-family",  "reason": "System font stack is part of clean, modern brand aesthetic" }
]
```

Any variant the Evolver proposes whose diff touches `(:root, index.html, --green)` — or any other tuple in this list — is invalid by construction.

---

## Files

```
repo/
├─ src/
│  ├─ server.ts                              # MCP entrypoint, registers vibe_identifier
│  ├─ shared/llm.ts                          # OpenRouter client + model selection
│  └─ agents/vibe-identifier/
│     ├─ index.ts                            # public exports
│     ├─ schema.ts                           # zod input/output
│     ├─ tools.ts                            # glob / read_file / grep / submit_findings
│     ├─ prompt.ts                           # system prompt
│     └─ loop.ts                             # the agent loop
├─ scripts/run-vibe.ts                       # standalone runner
└─ test/
   ├─ vibe-identifier.test.ts                # live OpenRouter test
   └─ fixtures/simplefit/index.html          # the worked example
```
