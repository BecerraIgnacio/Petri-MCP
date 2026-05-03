import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SimulationResult } from "./simulation-types.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderLineageHtml(result: SimulationResult): string {
  // Inline the lineage as JSON so the page works from file:// without fetch.
  const lineageJson = JSON.stringify(result, null, 0);
  const winner = escapeHtml(result.winner);
  const simId = escapeHtml(result.simId);
  const metricName = escapeHtml(result.metric.name);
  const metricArrow = result.metric.direction === "increase" ? "↑" : "↓";
  const cfg = result.config;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>petri-mcp · ${simId}</title>
  <style>
    @font-face {
      font-family: "Geist";
      src: url("https://petri-mcp.vercel.app/fonts/Geist-Variable.woff2") format("woff2-variations");
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "Geist Mono";
      src: url("https://petri-mcp.vercel.app/fonts/GeistMono-Variable.woff2") format("woff2-variations");
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }

    :root {
      --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      --font-mono: "Geist Mono", ui-monospace, "SF Mono", Monaco, Menlo, monospace;
      --bg: #0a0a0a;
      --bg-elev-1: #111111;
      --bg-elev-2: #161616;
      --fg: #ededed;
      --fg-muted: #888888;
      --fg-subtle: #555555;
      --border: #1f1f1f;
      --border-strong: #2a2a2a;
      --accent: #0070f3;
      --accent-fg: #ffffff;
      --radius: 6px;
      --radius-pill: 999px;
      --header-h: 56px;
    }

    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--fg);
      display: grid;
      grid-template-rows: var(--header-h) 1fr;
      overflow: hidden;
      font-size: 14px;
      letter-spacing: -0.01em;
      font-feature-settings: "cv11" 1, "ss01" 1;
      -webkit-font-smoothing: antialiased;
    }

    header {
      padding: 0 var(--space-lg, 24px);
      padding-left: 24px;
      padding-right: 24px;
      border-bottom: 1px solid var(--border);
      background: rgba(10, 10, 10, 0.85);
      backdrop-filter: saturate(180%) blur(12px);
      -webkit-backdrop-filter: saturate(180%) blur(12px);
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--fg-muted);
      height: var(--header-h);
    }
    header .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.015em;
      color: var(--fg);
      margin-right: 8px;
    }
    header .brand-mark {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      background: var(--fg);
    }
    header .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      height: 22px;
      border-radius: var(--radius-pill);
      background: var(--bg-elev-1);
      border: 1px solid var(--border-strong);
      color: var(--fg-muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.005em;
    }
    header .badge.winner-badge {
      background: rgba(0, 112, 243, 0.12);
      border-color: rgba(0, 112, 243, 0.4);
      color: #69b1ff;
    }
    header .badge.metric-badge {
      margin-left: auto;
      background: transparent;
      border-color: var(--border-strong);
      color: var(--fg);
    }

    main {
      display: grid;
      grid-template-columns: 460px 1fr;
      min-height: 0;
    }
    #tree {
      padding: 24px;
      overflow: auto;
      border-right: 1px solid var(--border);
      background: var(--bg);
    }
    .gen-row { margin-bottom: 28px; }
    .gen-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg-muted);
      margin-bottom: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .gen-cards { display: flex; flex-direction: column; gap: 6px; }

    .card {
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      background: var(--bg-elev-1);
      transition: border-color 0.12s ease, background 0.12s ease;
      font-size: 12px;
    }
    .card:hover {
      border-color: var(--border-strong);
      background: var(--bg-elev-2);
    }
    .card.selected {
      border-color: var(--accent);
      background: rgba(0, 112, 243, 0.06);
      box-shadow: 0 0 0 1px var(--accent) inset;
    }
    .card .row1 {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 6px;
    }
    .card .id {
      font-family: var(--font-mono);
      font-weight: 600;
      font-size: 13px;
      color: var(--fg);
      letter-spacing: -0.01em;
    }
    .card .parent {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--fg-subtle);
    }
    .card .rates {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--fg-muted);
      font-variant-numeric: tabular-nums;
      margin-top: 2px;
      letter-spacing: -0.005em;
    }
    .card .hypothesis {
      font-size: 11px;
      color: var(--fg-muted);
      margin-top: 8px;
      line-height: 1.5;
    }

    .badge-outcome {
      display: inline-block;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-weight: 600;
      margin-top: 8px;
      border: 1px solid transparent;
    }
    .out-seed {
      background: var(--bg-elev-2);
      color: var(--fg-muted);
      border-color: var(--border-strong);
    }
    .out-promoted, .out-previous_champion {
      background: transparent;
      color: #69b1ff;
      border-color: rgba(0, 112, 243, 0.4);
    }
    .out-abandoned {
      background: transparent;
      color: var(--fg-subtle);
      border-color: var(--border);
    }
    .out-current_champion {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: var(--accent);
    }

    /* Cards on the winning lineage chain get a subtle accent tint. */
    .card.lineage-winner {
      border-color: rgba(0, 112, 243, 0.4);
      background: rgba(0, 112, 243, 0.04);
    }
    .card.lineage-winner.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent) inset;
    }

    .frame-wrap {
      position: relative;
      background: #fff;
      min-height: 0;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: white;
    }
    .frame-meta {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(10, 10, 10, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: var(--fg);
      padding: 6px 10px;
      border-radius: var(--radius);
      font-size: 11px;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.005em;
      pointer-events: none;
      border: 1px solid var(--border-strong);
    }
  </style>
</head>
<body>
  <header>
    <span class="brand">
      <span class="brand-mark"></span>
      <span>petri-mcp</span>
    </span>
    <span class="badge">${simId}</span>
    <span class="badge winner-badge">winner ${winner}</span>
    <span class="badge">${cfg.generations} gens × ${cfg.sessionsPerGen} sessions</span>
    <span class="badge">split ${cfg.splitRatio}/${100 - cfg.splitRatio}</span>
    <span class="badge metric-badge">${metricName} ${metricArrow}</span>
  </header>
  <main>
    <div id="tree"></div>
    <div class="frame-wrap">
      <div class="frame-meta" id="frame-meta">—</div>
      <iframe id="frame" sandbox="allow-same-origin"></iframe>
    </div>
  </main>
  <script>
    const data = ${lineageJson};
    const byGen = {};
    for (const e of data.lineage) {
      (byGen[e.generation] ||= []).push(e);
    }
    const generations = Object.keys(byGen).map(Number).sort(function (a, b) { return a - b; });

    function fmt(n, d) { return n.toFixed(d); }
    function pct(n) { return (n * 100).toFixed(1) + '%'; }

    function el(tag, className, text) {
      const e = document.createElement(tag);
      if (className) e.className = className;
      if (text != null) e.textContent = String(text);
      return e;
    }

    // Walk the parent chain up from the winner to mark every entry in the winning lineage.
    const winningChainIds = new Set();
    {
      let cur = data.lineage.find(function (e) { return e.id === data.winner; });
      while (cur) {
        winningChainIds.add(cur.id);
        if (!cur.parent) break;
        cur = data.lineage.find(function (e) { return e.id === cur.parent; });
      }
    }

    function buildCard(entry) {
      const card = el('div', 'card');
      if (winningChainIds.has(entry.id)) card.classList.add('lineage-winner');
      card.dataset.id = entry.id;

      const row1 = el('div', 'row1');
      row1.appendChild(el('span', 'id', entry.id));
      row1.appendChild(el('span', 'parent', entry.parent ? '← ' + entry.parent : 'root'));
      card.appendChild(row1);

      card.appendChild(
        el(
          'div',
          'rates',
          'intrinsic ' + fmt(entry.intrinsicRate, 3) + ' · observed ' + fmt(entry.observedRate, 3) + ' (' + entry.conversions + '/' + entry.sessions + ')'
        )
      );

      if (Array.isArray(entry.championRuns) && entry.championRuns.length > 0) {
        const summary = entry.championRuns
          .map(function (r) { return 'g' + r.generation + ': ' + r.conversions + '/' + r.sessions + ' (' + fmt(r.observedRate, 3) + ')'; })
          .join(' · ');
        card.appendChild(el('div', 'rates', 'as champion → ' + summary));
      }

      if (entry.hypothesis) {
        card.appendChild(el('div', 'hypothesis', entry.hypothesis));
      }

      const outClass = String(entry.outcome).replace(/[^a-z_]/gi, '');
      const outcomeBadge = el('span', 'badge-outcome out-' + outClass, entry.outcome.replace('_', ' '));
      card.appendChild(outcomeBadge);

      card.addEventListener('click', function () { selectCard(entry); });
      return card;
    }

    function selectCard(entry) {
      document.querySelectorAll('.card').forEach(function (c) { c.classList.remove('selected'); });
      const node = document.querySelector('[data-id="' + entry.id + '"]');
      if (node) {
        node.classList.add('selected');
        node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      const frame = document.getElementById('frame');
      frame.src = 'gen' + entry.generation + '/' + entry.id + '/index.html';
      const meta = document.getElementById('frame-meta');
      meta.textContent = entry.id + ' · gen' + entry.generation + ' · ' + entry.outcome.replace('_', ' ') + ' · ' + pct(entry.intrinsicRate) + ' intrinsic';
    }

    const tree = document.getElementById('tree');
    for (const gen of generations) {
      const row = el('div', 'gen-row');
      const label = el('div', 'gen-label', 'Generation ' + gen + (gen === 0 ? ' · seed' : ''));
      row.appendChild(label);
      const cards = el('div', 'gen-cards');
      for (const entry of byGen[gen]) {
        cards.appendChild(buildCard(entry));
      }
      row.appendChild(cards);
      tree.appendChild(row);
    }

    const winnerEntry = data.lineage.find(function (e) { return e.id === data.winner; });
    if (winnerEntry) selectCard(winnerEntry);
    else if (data.lineage[0]) selectCard(data.lineage[0]);
  </script>
</body>
</html>
`;
}

export async function writeLineageHtml(
  result: SimulationResult,
  dir: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "index.html");
  await writeFile(filePath, renderLineageHtml(result), "utf8");
  return filePath;
}
