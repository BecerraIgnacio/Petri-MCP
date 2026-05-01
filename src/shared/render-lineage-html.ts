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
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      display: grid;
      grid-template-rows: auto 1fr;
      overflow: hidden;
    }
    header {
      padding: 12px 18px;
      border-bottom: 1px solid #1f1f1f;
      background: linear-gradient(180deg, #141414 0%, #0f0f0f 100%);
      display: flex;
      gap: 20px;
      align-items: baseline;
      flex-wrap: wrap;
      font-size: 12px;
      color: #aaa;
    }
    header h1 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #fafafa;
      letter-spacing: -0.01em;
    }
    header .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 8px;
      border-radius: 999px;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      font-variant-numeric: tabular-nums;
    }
    header .winner-badge {
      background: #422006;
      border-color: #92400e;
      color: #fbbf24;
    }
    main {
      display: grid;
      grid-template-columns: 460px 1fr;
      min-height: 0;
    }
    #tree {
      padding: 16px;
      overflow: auto;
      border-right: 1px solid #1f1f1f;
      background: #0a0a0a;
    }
    .gen-row { margin-bottom: 22px; }
    .gen-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #6b6b6b;
      margin-bottom: 10px;
      font-weight: 600;
    }
    .gen-cards { display: flex; flex-direction: column; gap: 6px; }
    .card {
      padding: 10px 12px;
      border: 1px solid #232323;
      border-radius: 6px;
      cursor: pointer;
      background: #131313;
      transition: border-color 0.1s, background 0.1s;
      font-size: 12px;
    }
    .card:hover { border-color: #3a3a3a; background: #161616; }
    .card.selected {
      border-color: #4ade80;
      background: #0f1f15;
      box-shadow: 0 0 0 1px #4ade80 inset;
    }
    .card .row1 {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 4px;
    }
    .card .id { font-weight: 700; font-size: 13px; color: #fafafa; }
    .card .parent { font-size: 11px; color: #6b6b6b; }
    .card .rates {
      font-size: 11px;
      color: #888;
      font-variant-numeric: tabular-nums;
      margin-top: 2px;
      letter-spacing: 0.01em;
    }
    .card .hypothesis {
      font-size: 11px;
      color: #999;
      margin-top: 6px;
      font-style: italic;
      line-height: 1.4;
    }
    .badge-outcome {
      display: inline-block;
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 3px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      font-weight: 600;
      margin-top: 6px;
    }
    .out-seed { background: #1e3a8a40; color: #93c5fd; border: 1px solid #1e40af; }
    .out-promoted { background: #14532d40; color: #86efac; border: 1px solid #166534; }
    .out-abandoned { background: #18181b; color: #71717a; border: 1px solid #27272a; }
    .out-current_champion {
      background: #422006;
      color: #fbbf24;
      border: 1px solid #d97706;
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
      top: 8px;
      right: 8px;
      background: #0a0a0aaa;
      backdrop-filter: blur(6px);
      color: #fafafa;
      padding: 6px 10px;
      border-radius: 5px;
      font-size: 11px;
      font-family: ui-monospace, "JetBrains Mono", monospace;
      pointer-events: none;
      border: 1px solid #2a2a2a;
    }
  </style>
</head>
<body>
  <header>
    <h1>🧬 petri-mcp · simulation explorer</h1>
    <span class="badge">${simId}</span>
    <span class="badge winner-badge">winner: ${winner}</span>
    <span class="badge">${cfg.generations} gens × ${cfg.sessionsPerGen} sessions · split ${cfg.splitRatio}/${100 - cfg.splitRatio}</span>
    <span class="badge" style="margin-left: auto">metric: ${metricName} ${metricArrow}</span>
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

    function buildCard(entry) {
      const card = el('div', 'card');
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
