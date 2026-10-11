import type { AnnotatedDiff, AnnotatedFile, AnnotatedHunk } from '../types.js';
import { FLAG_ORDER } from '../resolve/flags.js';
import { MISMATCH_NOTE, fmtTokens, verdict } from './terminal.js';

export function renderHtml(d: AnnotatedDiff): string {
  const v = verdict(d);
  const entries = d.files.flatMap((f) => f.hunks.map((h) => ({ f, h })));
  const flagged = entries.filter((e) => e.h.flags.length > 0).sort((a, b) => worst(a.h) - worst(b.h) || a.f.path.localeCompare(b.f.path) || a.h.newStart - b.h.newStart);

  const counts = FLAG_ORDER.filter((f) => d.totals.flagged[f] > 0).map((f) => `<span class="chip ${f}">${d.totals.flagged[f]} ${f}</span>`).join(' ');
  const fileList = d.files.map((f) => {
    const n = f.hunks.filter((h) => h.flags.length).length;
    return `<li><a href="#f-${esc(f.path)}">${esc(f.path)}</a>${n ? ` <span class="count">${n}</span>` : ''}</li>`;
  }).join('\n');

  const flaggedHtml = flagged.map(({ f, h }) => hunk(f, h)).join('\n');
  const unflaggedHtml = d.files.map((f) => {
    const rest = f.hunks.filter((h) => h.flags.length === 0);
    if (!rest.length) return '';
    return `<details class="unflagged"><summary>${esc(f.path)} · ${rest.length} unflagged · ${f.turnIds.length} turn(s) · ${fmtTokens(f.cost)} tokens</summary>\n${rest.map((h) => hunk(f, h)).join('\n')}\n</details>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>whyline: ${esc(v)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>${esc(v)}</h1>
  <p class="meta">${esc(d.range)} · ${d.sessions.length} session(s) · ${fmtTokens(d.totals.cost)} tokens</p>
  <p>${counts}</p>
</header>
<main>
  <nav><ul>${fileList}</ul></nav>
  <section>
${flaggedHtml}
${unflaggedHtml}
  </section>
</main>
</body>
</html>
`;
}

function hunk(f: AnnotatedFile, h: AnnotatedHunk): string {
  const chips = h.flags.map((x) => `<span class="chip ${x.flag}" title="${esc(x.detail)}">${x.flag}</span> <span class="detail">${esc(x.detail)}</span>`).join('<br>');
  const p = h.lead;
  const who = p ? (p.agentId === p.sessionId ? 'main agent' : `subagent ${p.agentName ?? p.agentId}`) : '';
  const prov = p
    ? `<p class="prov">turn ${esc(p.turnId)} · ${p.harness} · ${esc(who)} · ${fmtTokens(p.turnCost)} tokens · ${new Date(p.at).toISOString().slice(0, 16).replace('T', ' ')}${h.otherTurns ? ` · +${h.otherTurns} other turn(s)` : ''}</p>
<details open><summary>prompt</summary><pre>${esc(p.prompt.text)}</pre></details>
${p.reasoning ? `<details><summary>reasoning</summary><pre>${esc(p.reasoning.text)}</pre></details>` : ''}`
    : '<p class="prov">no provenance</p>';
  const code = [...h.removed.map((r) => `<span class="del">-${esc(r)}</span>`), ...h.lines.map((l) => `<span class="add">+${esc(l.text)}</span>`)].join('\n');
  const seg = (s: number, n: number) => (n === 1 ? `${s}` : `${s},${n}`);
  return `<article class="hunk" id="f-${esc(f.path)}">
<h2>${esc(f.path)} <code>@@ -${seg(h.oldStart, h.oldLines)} +${seg(h.newStart, h.newLines)} @@</code></h2>
${chips ? `<p class="flags">${chips}</p>` : ''}
${f.ledgerMismatch ? `<p class="prov">${MISMATCH_NOTE}</p>` : ''}
${prov}
<pre class="diff">${code}</pre>
</article>`;
}

function worst(h: AnnotatedHunk): number {
  return Math.min(...h.flags.map((x) => FLAG_ORDER.indexOf(x.flag)));
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CSS = `
:root { --bg:#fff; --fg:#1b1b1b; --dim:#666; --line:#e5e5e5; --add:#e6ffed; --del:#ffeef0; --flag:#b42318; --chip:#fff3cd; }
@media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#e8e8e8; --dim:#9a9a9a; --line:#2a2a2a; --add:#12361f; --del:#3d1418; --flag:#ff8a80; --chip:#4a3b00; } }
body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,sans-serif; color:var(--fg); background:var(--bg); }
header { padding:20px 24px; border-bottom:1px solid var(--line); }
h1 { font-size:18px; margin:0 0 4px; }
.meta { color:var(--dim); margin:0 0 8px; }
main { display:grid; grid-template-columns:260px 1fr; min-height:calc(100vh - 90px); }
nav { border-right:1px solid var(--line); padding:16px; }
nav ul { list-style:none; margin:0; padding:0; }
nav li { margin:4px 0; word-break:break-all; }
nav a { color:inherit; text-decoration:none; }
.count { color:var(--flag); font-weight:600; margin-left:6px; }
section { padding:16px 24px; max-width:1100px; }
.hunk { border:1px solid var(--line); border-radius:6px; padding:12px 16px; margin:0 0 16px; }
.hunk h2 { font-size:14px; margin:0 0 8px; }
.hunk h2 code { color:var(--dim); font-weight:400; margin-left:8px; }
.chip { display:inline-block; padding:1px 8px; border-radius:10px; background:var(--chip); color:var(--flag); font-weight:600; font-size:12px; }
.detail { color:var(--dim); }
.prov { color:var(--dim); margin:8px 0 4px; }
details { margin:4px 0; } summary { cursor:pointer; color:var(--dim); }
pre { margin:4px 0; padding:8px 10px; background:transparent; border:1px solid var(--line); border-radius:4px; overflow-x:auto; font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; white-space:pre-wrap; }
pre.diff { white-space:pre; }
.add { display:block; background:var(--add); } .del { display:block; background:var(--del); }
details.unflagged { margin-top:24px; }
@media (max-width:800px) { main { grid-template-columns:1fr; } nav { border-right:0; border-bottom:1px solid var(--line); } }
`;
