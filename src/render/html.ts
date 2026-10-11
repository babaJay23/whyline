import type { AnnotatedDiff, Provenance } from '../types.js';
import { FLAG_ORDER } from '../resolve/flags.js';
import { MISMATCH_NOTE, fmtTokens, verdict } from './terminal.js';
import { groupHunks, range, stamp, who, type Entry, type Group } from './groups.js';

export function renderHtml(d: AnnotatedDiff): string {
  const v = verdict(d);
  const { groups } = groupHunks(d, { all: true });

  const counts = FLAG_ORDER.filter((f) => d.totals.flagged[f] > 0).map((f) => `<span class="chip ${f}">${d.totals.flagged[f]} ${f}</span>`).join(' ');
  const fileList = d.files.map((f) => {
    const n = f.hunks.filter((h) => h.flags.length).length;
    const first = groups.flatMap((g) => g.entries).find((e) => e.f === f);
    const name = first ? `<a href="#${first.id}">${esc(f.path)}</a>` : esc(f.path);
    return `<li>${name}${n ? ` <span class="count">${n}</span>` : ''}</li>`;
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
  <p class="meta">${esc(d.range)} · ${d.sessions.length} session(s) · ${fmtTokens(d.totals.cost)}</p>
  <p>${counts}</p>
</header>
<main>
  <nav><ul>${fileList}</ul></nav>
  <div>
${groups.map(section).join('\n')}
  </div>
</main>
</body>
</html>
`;
}

function section(g: Group): string {
  const p = g.lead;
  const head = p
    ? `<h2>turn ${p.turnNumber} · ${p.harness} · ${esc(who(p))} · ${stamp(p.at)} · ${fmtTokens(p.turnCost)}</h2>
${p.agentBrief ? `<p class="ask"><b>brief</b> ${esc(p.agentBrief)}</p>` : ''}
<details open><summary>you asked</summary><pre>${esc(p.prompt.text)}</pre></details>
${p.reasoning ? `<details><summary>agent said</summary><pre>${esc(p.reasoning.text)}</pre></details>` : ''}`
    : '<h2>no turn found</h2>';
  return `<section class="turn">
${head}
${hunks(g, p).join('\n')}
</section>`;
}

function hunks(g: Group, p: Provenance | null): string[] {
  let said = p?.reasoning?.text ?? null;
  return g.entries.map((e) => {
    const own = e.h.lead?.reasoning?.text ?? null;
    const show = own !== null && own !== said ? own : null;
    if (own !== null) said = own;
    return hunk(e, show);
  });
}

function hunk({ f, h, id }: Entry, said: string | null): string {
  const chips = h.flags.map((x) => `<span class="chip ${x.flag}">${x.flag}</span> <span class="detail">${esc(x.detail)}</span>`).join('<br>');
  const own = said !== null ? `<details><summary>agent said</summary><pre>${esc(said)}</pre></details>` : '';
  const code = [...h.removed.map((r) => `<span class="del">-${esc(r)}</span>`), ...h.lines.map((l) => `<span class="add">+${esc(l.text)}</span>`)].join('\n');
  const body = `<article class="hunk" id="${id}">
<h3>${esc(f.path)} <code>${range(h)}</code></h3>
${chips ? `<p class="flags">${chips}</p>` : ''}
${f.ledgerMismatch ? `<p class="prov">${MISMATCH_NOTE}</p>` : ''}
${own}
<pre class="diff">${code}</pre>
</article>`;
  return h.flags.length ? body : `<details class="unflagged"><summary>${esc(f.path)} <code>${range(h)}</code> · unflagged</summary>\n${body}\n</details>`;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CSS = `
:root { --bg:#fff; --fg:#1b1b1b; --dim:#666; --line:#e5e5e5; --add:#e6ffed; --del:#ffeef0; --flag:#b42318; --chip:#fff3cd; --turn:#f6f6f6; }
@media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#e8e8e8; --dim:#9a9a9a; --line:#2a2a2a; --add:#12361f; --del:#3d1418; --flag:#ff8a80; --chip:#4a3b00; --turn:#181818; } }
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
main > div { padding:16px 24px; max-width:1100px; }
.turn { background:var(--turn); border:1px solid var(--line); border-radius:8px; padding:14px 18px; margin:0 0 20px; }
.turn h2 { font-size:15px; margin:0 0 8px; }
.ask { margin:4px 0; }
.hunk { background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:12px 16px; margin:12px 0 0; }
.hunk h3 { font-size:14px; margin:0 0 8px; }
.hunk h3 code, summary code { color:var(--dim); font-weight:400; margin-left:8px; }
.chip { display:inline-block; padding:1px 8px; border-radius:10px; background:var(--chip); color:var(--flag); font-weight:600; font-size:12px; }
.detail { color:var(--dim); }
.prov { color:var(--dim); margin:8px 0 4px; }
details { margin:4px 0; } summary { cursor:pointer; color:var(--dim); }
pre { margin:4px 0; padding:8px 10px; background:transparent; border:1px solid var(--line); border-radius:4px; overflow-x:auto; font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; white-space:pre-wrap; }
pre.diff { white-space:pre; }
.add { display:block; background:var(--add); } .del { display:block; background:var(--del); }
details.unflagged { margin-top:12px; }
@media (max-width:800px) { main { grid-template-columns:1fr; } nav { border-right:0; border-bottom:1px solid var(--line); } }
`;
