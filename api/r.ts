import type { IncomingMessage, ServerResponse } from "node:http";
import { getConnectRecord, getRunMeta } from "../src/shared/run-store.js";
import type { ConnectRecord, OriginSource, RunMeta } from "../src/shared/run-meta.js";

export const config = {
  maxDuration: 10,
};

function parseQuery(req: IncomingMessage): URLSearchParams {
  const host = req.headers.host ?? "localhost";
  const protocol = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  return url.searchParams;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function originSourceLabel(o: OriginSource): { kind: string; href: string; label: string } {
  if (o.kind === "github") {
    return { kind: "github repo", href: o.repoUrl, label: o.repoUrl };
  }
  if (o.kind === "live") {
    return { kind: "live url", href: o.liveUrl, label: o.liveUrl };
  }
  return { kind: "local path", href: "#", label: o.projectRoot };
}

function originSourceUrl(o: OriginSource): string | null {
  if (o.kind === "github") return o.repoUrl;
  if (o.kind === "live") return o.liveUrl;
  return null;
}

function controlPanelHtml(record: ConnectRecord, runMeta: RunMeta | null): string {
  const origin = originSourceLabel(record.originSource);
  const created = new Date(record.createdAt).toISOString();
  const hasRun = runMeta !== null;
  const runUrl = hasRun ? `/p/${record.runId}/index.html` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>petri-mcp · ${escapeHtml(record.runId)}</title>
  <link rel="icon" type="image/png" href="/logo.png">
  <link rel="stylesheet" href="/theme.css">
  <style>
    main { max-width: 720px; margin: 0 auto; padding: var(--space-3xl) var(--space-lg); }
    h1 { font-size: 36px; letter-spacing: -0.025em; margin-bottom: var(--space-sm); }
    .runid { font-family: var(--font-mono); font-size: 14px; color: var(--fg-muted); margin-bottom: var(--space-xl); }
    .meta-card {
      padding: var(--space-lg);
      background: var(--bg-elev-1);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: var(--space-2xl);
    }
    .meta-row { display: flex; gap: var(--space-md); margin-bottom: var(--space-sm); font-size: 13px; }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-row .k {
      width: 100px;
      flex-shrink: 0;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 11px;
      font-weight: 600;
      padding-top: 1px;
    }
    .meta-row .v { color: var(--fg); word-break: break-all; }
    .meta-row .v a { color: var(--fg); text-decoration: underline; text-decoration-color: var(--border-strong); }
    .meta-row .v a:hover { text-decoration-color: var(--accent); }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); }
    @media (max-width: 560px) { .actions { grid-template-columns: 1fr; } }
    .action-card {
      padding: var(--space-lg);
      background: var(--bg-elev-1);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
      transition: border-color 0.12s ease;
    }
    .action-card:hover:not(.disabled) { border-color: var(--border-strong); }
    .action-card h2 { font-size: 16px; margin-bottom: 0; }
    .action-card p { color: var(--fg-muted); font-size: 13px; line-height: 1.5; flex: 1; }
    .action-card.disabled { opacity: 0.55; }
    .action-card.disabled .btn { pointer-events: none; }
    .gated-note {
      font-size: 11px;
      color: var(--fg-subtle);
      font-style: italic;
      line-height: 1.5;
    }
    .live-link {
      display: inline-block;
      margin-top: var(--space-md);
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--accent);
    }
  </style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">
      <span class="brand-mark"></span>
      <span>petri-mcp</span>
    </a>
    <nav>
      <a class="btn btn-ghost" href="/dashboard">Ad-hoc dashboard</a>
      <a class="btn btn-ghost" href="https://github.com/BecerraIgnacio/petri-MCP" target="_blank" rel="noreferrer">GitHub</a>
    </nav>
  </header>
  <main>
    <h1>Control panel</h1>
    <div class="runid">runId · ${escapeHtml(record.runId)}</div>

    <div class="meta-card">
      <div class="meta-row">
        <div class="k">Source</div>
        <div class="v">
          ${escapeHtml(origin.kind)} ·
          ${origin.href === "#" ? escapeHtml(origin.label) : `<a href="${escapeHtml(origin.href)}" target="_blank" rel="noreferrer">${escapeHtml(origin.label)}</a>`}
        </div>
      </div>
      <div class="meta-row">
        <div class="k">Connected</div>
        <div class="v">${escapeHtml(created)}</div>
      </div>
      ${hasRun
        ? `<div class="meta-row"><div class="k">Live run</div><div class="v"><a href="${escapeHtml(runUrl)}" target="_blank" rel="noreferrer">${escapeHtml(runUrl)}</a> · gen ${runMeta!.currentGeneration}</div></div>`
        : ""}
    </div>

    <div class="actions">
      <div class="action-card">
        <h2>Run simulation</h2>
        <p>Evolve this site against synthetic users. Deterministic, ~4 minutes per 3 generations, no production traffic. Renders a phylogenetic tree as it goes.</p>
        <a class="btn btn-primary" href="/r/${escapeHtml(record.runId)}/sim">Open simulator</a>
      </div>
      <div class="action-card disabled">
        <h2>Run real petri</h2>
        <p>90/10 split across real visitors, score and promote per generation. Currently gated on Vercel Blob + Upstash Redis Marketplace integrations.</p>
        <span class="btn btn-secondary" aria-disabled="true">Gated · needs marketplace</span>
        <span class="gated-note">Provision the integrations on the petri-mcp Vercel project to enable this path.</span>
      </div>
    </div>
  </main>
</body>
</html>`;
}

function notFoundHtml(runId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>petri-mcp · ${escapeHtml(runId)} not found</title>
  <link rel="icon" type="image/png" href="/logo.png">
  <link rel="stylesheet" href="/theme.css">
  <style>
    main { max-width: 540px; margin: 0 auto; padding: var(--space-3xl) var(--space-lg); text-align: center; }
    h1 { font-size: 28px; margin-bottom: var(--space-md); }
    p { color: var(--fg-muted); line-height: 1.6; margin-bottom: var(--space-lg); }
    code { font-family: var(--font-mono); background: var(--bg-elev-1); padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/"><span class="brand-mark"></span><span>petri-mcp</span></a>
  </header>
  <main>
    <h1>Run not found</h1>
    <p>No connected site found for runId <code>${escapeHtml(runId)}</code>. Run <code>connect_site</code> from your MCP client first to register a site.</p>
    <a class="btn btn-secondary" href="/">Back to landing</a>
  </main>
</body>
</html>`;
}

function simHtml(record: ConnectRecord): string {
  const sourceUrl = originSourceUrl(record.originSource);
  const sourceUrlJson = sourceUrl === null ? "null" : JSON.stringify(sourceUrl);
  const repoRefJson = record.originSource.kind === "github" && record.originSource.repoRef
    ? JSON.stringify(record.originSource.repoRef)
    : "null";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>petri-mcp · ${escapeHtml(record.runId)} · simulate</title>
  <link rel="icon" type="image/png" href="/logo.png">
  <link rel="stylesheet" href="/theme.css">
  <style>
    html, body { height: 100%; }
    body { display: grid; grid-template-rows: var(--header-h) 1fr; overflow: hidden; }
    main { display: grid; grid-template-columns: 460px 1fr; min-height: 0; }
    #left { padding: var(--space-lg); border-right: 1px solid var(--border); overflow: auto; }
    .runid-row { font-family: var(--font-mono); font-size: 12px; color: var(--fg-muted); margin-bottom: var(--space-md); display: flex; justify-content: space-between; align-items: baseline; }
    .runid-row a { color: var(--fg-muted); text-decoration: underline; text-decoration-color: var(--border-strong); }
    .source-row { font-size: 12px; color: var(--fg-muted); margin-bottom: var(--space-lg); word-break: break-all; }
    form { display: flex; flex-direction: column; gap: var(--space-md); margin-bottom: var(--space-xl); }
    label { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
    .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-sm); }
    .submit { width: 100%; justify-content: center; height: 40px; font-size: 14px; font-weight: 600; }
    .submit:disabled { opacity: 0.5; cursor: not-allowed; }
    .phases { font-size: 12px; color: var(--fg-muted); margin-bottom: var(--space-md); min-height: 18px; font-variant-numeric: tabular-nums; letter-spacing: -0.005em; }
    .gen-row { margin-bottom: var(--space-lg); }
    .gen-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-muted); margin-bottom: var(--space-sm); font-weight: 600; font-variant-numeric: tabular-nums; }
    .gen-cards { display: flex; flex-direction: column; gap: var(--space-xs); }
    .lcard { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-elev-1); font-size: 12px; transition: border-color 0.12s ease, background 0.12s ease; }
    .lcard:hover { border-color: var(--border-strong); }
    .lcard.lineage-winner { border-color: var(--accent); background: rgba(0, 112, 243, 0.06); }
    .lcard .row1 { display: flex; align-items: baseline; gap: var(--space-sm); margin-bottom: 4px; }
    .lcard .id { font-family: var(--font-mono); font-weight: 600; font-size: 13px; color: var(--fg); letter-spacing: -0.01em; }
    .lcard .parent { font-family: var(--font-mono); font-size: 11px; color: var(--fg-subtle); }
    .lcard .rates { font-family: var(--font-mono); font-size: 11px; color: var(--fg-muted); font-variant-numeric: tabular-nums; letter-spacing: -0.005em; }
    .lcard .hypothesis { font-size: 11px; color: var(--fg-muted); margin-top: 6px; line-height: 1.5; }
    .lbadge { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: var(--radius-pill); letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; margin-top: 8px; border: 1px solid transparent; }
    .out-seed { background: var(--bg-elev-2); color: var(--fg-muted); border-color: var(--border-strong); }
    .out-promoted, .out-previous_champion { background: transparent; color: #69b1ff; border-color: rgba(0, 112, 243, 0.4); }
    .out-abandoned { background: transparent; color: var(--fg-subtle); border-color: var(--border); }
    .out-current_champion { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
    .err { background: rgba(255, 77, 79, 0.08); color: #ff8a8c; border: 1px solid rgba(255, 77, 79, 0.4); padding: var(--space-md); border-radius: var(--radius); font-size: 12px; white-space: pre-wrap; font-family: var(--font-mono); margin-bottom: var(--space-md); }
    .err-banner { background: rgba(245, 166, 35, 0.08); color: #f5a623; border: 1px solid rgba(245, 166, 35, 0.4); padding: var(--space-md); border-radius: var(--radius); margin-bottom: var(--space-md); font-family: var(--font-sans); }
    .err-banner.no-tokens, .err-banner.invalid-key { background: rgba(255, 77, 79, 0.08); color: #ff8a8c; border-color: rgba(255, 77, 79, 0.4); }
    .err-banner .title { font-size: 13px; font-weight: 600; margin-bottom: 4px; letter-spacing: -0.005em; }
    .err-banner .msg { font-size: 12px; line-height: 1.55; color: var(--fg-muted); }
    .err-banner .raw { font-family: var(--font-mono); font-size: 10px; color: var(--fg-subtle); margin-top: var(--space-sm); white-space: pre-wrap; word-break: break-word; }
    #right { position: relative; background: var(--bg); min-height: 0; overflow: hidden; }
    #placeholder { position: absolute; inset: 0; display: grid; place-items: center; color: var(--fg-subtle); font-size: 13px; text-align: center; padding: var(--space-lg); }
    #placeholder .pwrap { max-width: 460px; display: flex; flex-direction: column; gap: var(--space-md); align-items: center; }
    #placeholder .picon { width: 36px; height: 36px; border-radius: var(--radius); background: var(--bg-elev-1); border: 1px solid var(--border); display: grid; place-items: center; color: var(--fg-muted); font-family: var(--font-mono); font-size: 14px; }
    #placeholder p { max-width: 420px; line-height: 1.6; color: var(--fg-muted); font-size: 13px; }
    iframe { width: 100%; height: 100%; border: 0; background: white; }
    .timer { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 12px; color: var(--fg-muted); letter-spacing: -0.005em; }
  </style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/"><span class="brand-mark"></span><span>petri-mcp</span><span class="badge badge-muted" style="margin-left:10px;">simulate</span></a>
    <nav>
      <span class="timer" id="timer"></span>
      <a class="btn btn-ghost" href="/r/${escapeHtml(record.runId)}">← Control panel</a>
      <a class="btn btn-ghost" href="https://github.com/BecerraIgnacio/petri-MCP" target="_blank" rel="noreferrer">GitHub</a>
    </nav>
  </header>
  <main>
    <div id="left">
      <div class="runid-row"><span>runId · ${escapeHtml(record.runId)}</span><a href="/r/${escapeHtml(record.runId)}">control panel</a></div>
      <div class="source-row">Source: ${escapeHtml(record.originSource.kind)} · ${escapeHtml(record.displayName)}</div>
      <form id="form">
        <div class="row">
          <label>Generations<input type="number" id="generations" value="3" min="1" max="10"></label>
          <label>Sessions/gen<input type="number" id="sessionsPerGen" value="1000" min="50" max="20000" step="100"></label>
          <label>Seed<input type="number" id="seed" placeholder="random" min="0"></label>
        </div>
        <button type="submit" id="submit" class="btn btn-primary submit">Simulate</button>
      </form>
      <div class="phases" id="phases">Click <strong>Simulate</strong> to evolve this site against synthetic users. Each generation, 90% of synthetic traffic goes to the champion and 10% spreads across challengers.</div>
      <div id="errorBox"></div>
      <div id="tree"></div>
    </div>
    <div id="right">
      <div id="placeholder">
        <div class="pwrap">
          <div class="picon">▲</div>
          <p>The phylogenetic-tree explorer renders here when the simulation finishes. Variants that strictly beat the champion get promoted.</p>
        </div>
      </div>
      <iframe id="frame" hidden></iframe>
    </div>
  </main>
  <script>
    const RUN_ID = ${JSON.stringify(record.runId)};
    const SOURCE_URL = ${sourceUrlJson};
    const REPO_REF = ${repoRefJson};
    const form = document.getElementById('form');
    const submitBtn = document.getElementById('submit');
    const phases = document.getElementById('phases');
    const errBox = document.getElementById('errorBox');
    const tree = document.getElementById('tree');
    const placeholder = document.getElementById('placeholder');
    const frame = document.getElementById('frame');
    const timerEl = document.getElementById('timer');
    let timerHandle = null;
    let startTs = 0;

    function fmt(n, d) { return Number(n).toFixed(d); }
    function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function startTimer() { startTs = Date.now(); timerEl.textContent = '00:00'; timerHandle = setInterval(() => { const s = Math.floor((Date.now() - startTs) / 1000); timerEl.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60); }, 1000); }
    function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }

    function renderLineage(lineage, winnerId) {
      const winningChain = new Set();
      if (winnerId) {
        const byId = new Map(lineage.map((e) => [e.id, e]));
        let cur = byId.get(winnerId);
        while (cur) { winningChain.add(cur.id); if (!cur.parent) break; cur = byId.get(cur.parent); }
      }
      const byGen = {};
      for (const e of lineage) (byGen[e.generation] ||= []).push(e);
      const gens = Object.keys(byGen).map(Number).sort((a, b) => a - b);
      tree.replaceChildren();
      for (const gen of gens) {
        const row = el('div', 'gen-row');
        row.appendChild(el('div', 'gen-label', 'Generation ' + gen + (gen === 0 ? ' · seed' : '')));
        const cards = el('div', 'gen-cards');
        for (const entry of byGen[gen]) {
          const card = el('div', 'lcard');
          if (winningChain.has(entry.id)) card.classList.add('lineage-winner');
          const r1 = el('div', 'row1');
          r1.appendChild(el('span', 'id', entry.id));
          r1.appendChild(el('span', 'parent', entry.parent ? '← ' + entry.parent : 'root'));
          card.appendChild(r1);
          card.appendChild(el('div', 'rates', 'intrinsic ' + fmt(entry.intrinsicRate, 3) + ' · observed ' + fmt(entry.observedRate, 3) + ' (' + entry.conversions + '/' + entry.sessions + ')'));
          if (entry.hypothesis) card.appendChild(el('div', 'hypothesis', entry.hypothesis));
          const outClass = String(entry.outcome).replace(/[^a-z_]/gi, '');
          card.appendChild(el('span', 'lbadge out-' + outClass, String(entry.outcome).replace('_', ' ')));
          cards.appendChild(card);
        }
        row.appendChild(cards);
        tree.appendChild(row);
      }
    }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      errBox.replaceChildren(); tree.replaceChildren();
      placeholder.style.display = 'grid'; frame.hidden = true;
      submitBtn.disabled = true; submitBtn.textContent = 'Simulating…';
      const params = new URLSearchParams();
      params.set('runId', RUN_ID);
      params.set('generations', document.getElementById('generations').value);
      params.set('sessionsPerGen', document.getElementById('sessionsPerGen').value);
      const seed = document.getElementById('seed').value.trim();
      if (seed !== '') params.set('seed', seed);
      const evt = new EventSource('/api/simulate?' + params.toString());
      let lastWinner = null;
      startTimer();
      evt.addEventListener('started', (m) => { const d = JSON.parse(m.data); phases.textContent = 'starting · ' + d.generations + ' gens × ' + d.sessionsPerGen + ' sessions'; });
      evt.addEventListener('phase', (m) => { const d = JSON.parse(m.data); phases.textContent = d.message; });
      evt.addEventListener('progress', (m) => {
        const d = JSON.parse(m.data);
        phases.textContent = 'gen ' + d.generation + ' done · ' + (d.summary.promoted ? 'promoted ' + d.summary.promoted : 'no promotion');
        const champion = d.lineage.find((e) => e.outcome === 'current_champion');
        lastWinner = champion ? champion.id : null;
        renderLineage(d.lineage, lastWinner);
      });
      evt.addEventListener('done', (m) => {
        const d = JSON.parse(m.data);
        phases.textContent = 'done · winner ' + d.winner;
        renderLineage(d.lineage, d.winner);
        if (d.explorerUrl) { placeholder.style.display = 'none'; frame.hidden = false; frame.src = d.explorerUrl; }
        evt.close(); submitBtn.disabled = false; submitBtn.textContent = 'Simulate'; stopTimer();
      });
      evt.addEventListener('error', (m) => {
        if (m && m.data) {
          try {
            const d = JSON.parse(m.data);
            if (d.code && d.code !== 'unknown') {
              const banner = el('div', 'err-banner ' + String(d.code).replace(/_/g, '-'));
              banner.appendChild(el('div', 'title', d.title || 'Simulation failed'));
              banner.appendChild(el('div', 'msg', d.message || ''));
              if (d.raw && d.raw !== d.message) banner.appendChild(el('div', 'raw', d.raw));
              errBox.appendChild(banner);
            } else {
              errBox.appendChild(el('div', 'err', 'simulation failed: ' + (d.message || d.raw || '') + (d.stack ? '\\n' + d.stack : '')));
            }
          } catch (_) {
            errBox.appendChild(el('div', 'err', String(m.data)));
          }
        } else if (evt.readyState === EventSource.CLOSED) {
          errBox.appendChild(el('div', 'err', 'connection closed before completion'));
        }
        evt.close(); submitBtn.disabled = false; submitBtn.textContent = 'Simulate'; stopTimer();
      });
    });
  </script>
</body>
</html>`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("method not allowed");
    return;
  }
  const qs = parseQuery(req);
  const runId = qs.get("runId");
  const view = qs.get("view");
  if (!runId || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(runId)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("invalid or missing runId");
    return;
  }

  let record: ConnectRecord | null = null;
  try {
    record = await getConnectRecord(runId);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`failed to read connect record: ${(err as Error).message}`);
    return;
  }

  if (!record) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(notFoundHtml(runId));
    return;
  }

  if (view === "sim") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(simHtml(record));
    return;
  }

  let runMeta: RunMeta | null = null;
  try {
    runMeta = await getRunMeta(runId);
  } catch {
    // non-fatal: control panel still renders without the live-run row
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(controlPanelHtml(record, runMeta));
}
