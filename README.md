# petri-mcp

MCP server for v0 — evolves a user-built website toward higher metrics by running 90/10 traffic splits across variants, with a vibe-keeper agent that locks brand-defining elements (logo, key phrases, palette) and a UX/UI evolver agent that mutates everything else; champions winning 3 generations in a row trigger 2^(n-3) backoff.

## Status
Active — in development.

## What it does
You build a website on **v0**. You like the result. You install **petri-mcp**. From now on:

1. petri reads your site and figures out *what makes it your brand* (logo, palette, recurring phrases, voice). Those are **locked**.
2. petri picks the metric that matters for your site type (conversion for SaaS, scroll depth for news, retention for ads-supported, …).
3. Each generation, petri produces ~3 variants of your site — small, brand-respecting mutations.
4. **90% of traffic** goes to the current champion, **10%** is split across the variants.
5. Any variant that beats the champion on the target metric gets promoted to *new champion*.
6. When a champion holds for 3 generations in a row, petri widens the gap between new generations by `2^(n−3)` — explore less, exploit more, leave the winner alone.

## Stack
_(language, framework, key deps — TBD)_

## MCP tool inputs

Both `vibe_identifier` and `ux_ui_evolver` accept either a local path or a public GitHub URL. Provide **exactly one** of:

- `projectRoot` — absolute path to a project directory on the host filesystem (local dev / stdio mode).
- `repoUrl` — `https://github.com/<owner>/<repo>` for a public repo. Optional `repoRef` selects a branch or tag; defaults to the repo's default branch. petri-mcp shallow-clones the repo to a `/tmp/petri-cache/<owner>-<repo>-<ref>/` directory on first call and reuses the cache on subsequent calls.

Private-repo authentication (PAT) is plumbed in the constructor but not yet exposed at the tool level — Phase 1 ships public-repo support.

## Running locally
```bash
# fill in once runnable
```

## License
_(add if/when relevant)_
