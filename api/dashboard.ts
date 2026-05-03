import type { IncomingMessage, ServerResponse } from "node:http";

export const config = {
  maxDuration: 10,
};

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>petri-mcp · simulate</title>
  <link rel="icon" type="image/png" href="/logo.png">
  <link rel="stylesheet" href="/theme.css">
  <style>
    html, body { height: 100%; }
    body {
      display: grid;
      grid-template-rows: var(--header-h) 1fr;
      overflow: hidden;
    }
    main {
      display: grid;
      grid-template-columns: 460px 1fr;
      min-height: 0;
    }
    #left {
      padding: var(--space-lg);
      border-right: 1px solid var(--border);
      overflow: auto;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
      margin-bottom: var(--space-xl);
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 11px;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 600;
    }
    .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-sm); }
    .submit {
      width: 100%;
      justify-content: center;
      height: 40px;
      font-size: 14px;
      font-weight: 600;
    }
    .submit:disabled { opacity: 0.5; cursor: not-allowed; }

    .phases {
      font-size: 12px;
      color: var(--fg-muted);
      margin-bottom: var(--space-md);
      min-height: 18px;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.005em;
    }
    .phases code {
      background: var(--bg-elev-1);
      border: 1px solid var(--border);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 11px;
    }

    .gen-row { margin-bottom: var(--space-lg); }
    .gen-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg-muted);
      margin-bottom: var(--space-sm);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .gen-cards { display: flex; flex-direction: column; gap: var(--space-xs); }

    .lcard {
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--bg-elev-1);
      font-size: 12px;
      transition: border-color 0.12s ease, background 0.12s ease;
    }
    .lcard:hover { border-color: var(--border-strong); }
    .lcard.lineage-winner {
      border-color: var(--accent);
      background: rgba(0, 112, 243, 0.06);
    }
    .lcard .row1 {
      display: flex;
      align-items: baseline;
      gap: var(--space-sm);
      margin-bottom: 4px;
    }
    .lcard .id {
      font-family: var(--font-mono);
      font-weight: 600;
      font-size: 13px;
      color: var(--fg);
      letter-spacing: -0.01em;
    }
    .lcard .parent {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--fg-subtle);
    }
    .lcard .rates {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--fg-muted);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.005em;
    }
    .lcard .hypothesis {
      font-size: 11px;
      color: var(--fg-muted);
      margin-top: 6px;
      line-height: 1.5;
    }
    .lbadge {
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

    .err {
      background: rgba(255, 77, 79, 0.08);
      color: #ff8a8c;
      border: 1px solid rgba(255, 77, 79, 0.4);
      padding: var(--space-md);
      border-radius: var(--radius);
      font-size: 12px;
      white-space: pre-wrap;
      font-family: var(--font-mono);
      margin-bottom: var(--space-md);
    }

    #right {
      position: relative;
      background: var(--bg);
      min-height: 0;
      overflow: hidden;
    }
    #placeholder {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--fg-subtle);
      font-size: 13px;
      text-align: center;
      padding: var(--space-lg);
    }
    #placeholder .pwrap {
      max-width: 460px;
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
      align-items: center;
    }
    #placeholder .picon {
      width: 36px; height: 36px;
      border-radius: var(--radius);
      background: var(--bg-elev-1);
      border: 1px solid var(--border);
      display: grid;
      place-items: center;
      color: var(--fg-muted);
      font-family: var(--font-mono);
      font-size: 14px;
    }
    #placeholder p {
      max-width: 420px;
      line-height: 1.6;
      color: var(--fg-muted);
      font-size: 13px;
    }
    iframe { width: 100%; height: 100%; border: 0; background: white; }

    .timer {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: 12px;
      color: var(--fg-muted);
      letter-spacing: -0.005em;
    }
  </style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">
      <span class="brand-mark"></span>
      <span>petri-mcp</span>
      <span class="badge badge-muted" style="margin-left:10px;">simulate</span>
    </a>
    <nav>
      <span class="timer" id="timer"></span>
      <a class="btn btn-ghost" href="/">Landing</a>
      <a class="btn btn-ghost" href="https://github.com/BecerraIgnacio/petri-MCP" target="_blank" rel="noreferrer">GitHub</a>
    </nav>
  </header>
  <main>
    <div id="left">
      <form id="form">
        <label>
          Site URL or GitHub repo
          <input type="text" id="url" placeholder="https://your-v0-site.vercel.app" required>
        </label>
        <div class="row">
          <label>
            Generations
            <input type="number" id="generations" value="2" min="1" max="10">
          </label>
          <label>
            Sessions/gen
            <input type="number" id="sessionsPerGen" value="1000" min="50" max="20000" step="100">
          </label>
          <label>
            Seed
            <input type="number" id="seed" placeholder="random" min="0">
          </label>
        </div>
        <button type="submit" id="submit" class="btn btn-primary submit">Simulate</button>
      </form>
      <div class="phases" id="phases">Paste your v0 site's <code>.vercel.app</code> URL or a static-HTML GitHub repo. petri fetches the rendered HTML, evolves it, and shows you the lineage.</div>
      <div id="errorBox"></div>
      <div id="tree"></div>
    </div>
    <div id="right">
      <div id="placeholder">
        <div class="pwrap">
          <div class="picon">▲</div>
          <p>The phylogenetic-tree explorer renders here when the simulation finishes. Each generation, 90% of synthetic traffic goes to the current champion and 10% spreads across challengers. Variants that strictly beat the champion get promoted.</p>
        </div>
      </div>
      <iframe id="frame" hidden></iframe>
    </div>
  </main>
  <script>
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
    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = String(text);
      return e;
    }
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function startTimer() {
      startTs = Date.now();
      timerEl.textContent = '00:00';
      timerHandle = setInterval(() => {
        const s = Math.floor((Date.now() - startTs) / 1000);
        timerEl.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
      }, 1000);
    }
    function stopTimer() {
      if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    }

    function renderLineage(lineage, winnerId) {
      const winningChain = new Set();
      if (winnerId) {
        const byId = new Map(lineage.map((e) => [e.id, e]));
        let cur = byId.get(winnerId);
        while (cur) {
          winningChain.add(cur.id);
          if (!cur.parent) break;
          cur = byId.get(cur.parent);
        }
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
          card.appendChild(el('div', 'rates',
            'intrinsic ' + fmt(entry.intrinsicRate, 3) + ' · observed ' + fmt(entry.observedRate, 3) + ' (' + entry.conversions + '/' + entry.sessions + ')'
          ));
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
      errBox.replaceChildren();
      tree.replaceChildren();
      placeholder.style.display = 'grid';
      frame.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Simulating…';

      const params = new URLSearchParams();
      params.set('url', document.getElementById('url').value.trim());
      params.set('generations', document.getElementById('generations').value);
      params.set('sessionsPerGen', document.getElementById('sessionsPerGen').value);
      const seed = document.getElementById('seed').value.trim();
      if (seed !== '') params.set('seed', seed);

      const evt = new EventSource('/api/simulate?' + params.toString());
      let lastWinner = null;
      startTimer();

      evt.addEventListener('started', (m) => {
        const d = JSON.parse(m.data);
        phases.textContent = 'starting · ' + d.generations + ' gens × ' + d.sessionsPerGen + ' sessions';
      });
      evt.addEventListener('phase', (m) => {
        const d = JSON.parse(m.data);
        phases.textContent = d.message;
      });
      evt.addEventListener('progress', (m) => {
        const d = JSON.parse(m.data);
        phases.textContent = 'gen ' + d.generation + ' done · ' + (d.summary.promoted ? 'promoted ' + d.summary.promoted : 'no promotion');
        // Find current champion to render the winning chain so far
        const champion = d.lineage.find((e) => e.outcome === 'current_champion');
        lastWinner = champion ? champion.id : null;
        renderLineage(d.lineage, lastWinner);
      });
      evt.addEventListener('done', (m) => {
        const d = JSON.parse(m.data);
        phases.textContent = 'done · winner ' + d.winner;
        renderLineage(d.lineage, d.winner);
        if (d.explorerUrl) {
          placeholder.style.display = 'none';
          frame.hidden = false;
          frame.src = d.explorerUrl;
        }
        evt.close();
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simulate';
        stopTimer();
      });
      evt.addEventListener('error', (m) => {
        // Two error shapes: server-emitted SSE 'error' event with .data, or browser EventSource onerror with no .data.
        if (m && m.data) {
          try {
            const d = JSON.parse(m.data);
            const box = el('div', 'err', 'simulation failed: ' + d.message + (d.stack ? '\n' + d.stack : ''));
            errBox.appendChild(box);
          } catch (_) {
            errBox.appendChild(el('div', 'err', String(m.data)));
          }
        } else if (evt.readyState === EventSource.CLOSED) {
          errBox.appendChild(el('div', 'err', 'connection closed before completion'));
        }
        evt.close();
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simulate';
        stopTimer();
      });
    });
  </script>
</body>
</html>
`;

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.end(HTML);
}
