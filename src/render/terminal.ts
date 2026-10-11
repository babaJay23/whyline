import type { AnnotatedDiff, AnnotatedFile, AnnotatedHunk, Usage } from '../types.js';
import { FLAG_ORDER } from '../resolve/flags.js';
import { paint } from './ansi.js';

export function fmtTokens(u: Usage | null): string {
  if (!u) return '–';
  const n = u.input + u.output + u.cacheRead + u.cacheWrite;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function verdict(d: AnnotatedDiff): string {
  if (d.totals.hunks === 0) return 'no changes';
  const hunks = d.files.flatMap((f) => f.hunks);
  const flaggedHunks = hunks.filter((h) => h.flags.length > 0).length;
  const head = `${d.totals.hunks} ${plural(d.totals.hunks, 'hunk')} across ${d.totals.files} ${plural(d.totals.files, 'file')}`;
  if (flaggedHunks === 0) return `${head}, nothing flagged`;
  const count = (flag: string) => hunks.reduce((n, h) => n + h.flags.filter((x) => x.flag === flag).length, 0);
  const parts = FLAG_ORDER.map((f) => [count(f), f] as const).filter(([n]) => n > 0).map(([n, f]) => `${n} ${f}`);
  return `${head}, ${flaggedHunks} ${flaggedHunks === 1 ? 'needs' : 'need'} a look: ${parts.join(', ')}`;
}

export function renderTerminal(d: AnnotatedDiff, opts: { color: boolean; all: boolean }): string {
  const c = paint(opts.color);
  const out: string[] = [c.bold(verdict(d)), ''];

  const entries = d.files.flatMap((f) => f.hunks.map((h) => ({ f, h })));
  const flagged = entries.filter((e) => e.h.flags.length > 0).sort(byWorst);
  const rest = entries.filter((e) => e.h.flags.length === 0);

  for (const { f, h } of flagged) out.push(...hunkBlock(f, h, c), '');
  if (opts.all) {
    for (const { f, h } of rest) out.push(...hunkBlock(f, h, c), '');
  } else if (rest.length) {
    out.push(c.dim('unflagged:'));
    for (const f of d.files) {
      const n = f.hunks.filter((h) => h.flags.length === 0).length;
      if (n === 0) continue;
      out.push(c.dim(`  ${f.path}  ${n} ${plural(n, 'hunk')}  ${f.turnIds.length} ${plural(f.turnIds.length, 'turn')}  ${fmtTokens(f.cost)} tokens`));
    }
    out.push('');
  }
  return out.join('\n');
}

export const MAX_HUNK_LINES = 40;
export const MISMATCH_NOTE = 'file differs from what the recorded edits produce; some lines were changed another way';

function hunkBlock(f: AnnotatedFile, h: AnnotatedHunk, c: ReturnType<typeof paint>): string[] {
  const lines: string[] = [`${c.bold(f.path)} ${c.cyan(range(h))}`];
  for (const fl of h.flags) lines.push(`  ${c.red('!')} ${c.yellow(fl.flag)}  ${fl.detail}`);
  if (f.ledgerMismatch) lines.push(c.dim(`  ${MISMATCH_NOTE}`));
  if (h.lead) {
    const p = h.lead;
    const who = p.agentId === p.sessionId ? 'main agent' : `subagent ${p.agentName ?? p.agentId}`;
    lines.push(c.dim(`  turn ${p.turnId} · ${p.harness} · ${who} · ${fmtTokens(p.turnCost)} tokens · ${stamp(p.at)}`));
    lines.push(`  prompt: ${oneLine(p.prompt.text, 120)}`);
    if (p.reasoning) lines.push(c.dim(`  reasoning: ${oneLine(p.reasoning.text, 160)}`));
    if (h.otherTurns > 0) lines.push(c.dim(`  (+${h.otherTurns} other ${plural(h.otherTurns, 'turn')})`));
  } else {
    lines.push(c.dim('  (no provenance)'));
  }
  const body = [...h.removed.map((r) => c.red(`-${r}`)), ...h.lines.map((l) => c.green(`+${l.text}`))];
  lines.push(...body.slice(0, MAX_HUNK_LINES));
  if (body.length > MAX_HUNK_LINES) lines.push(c.dim(`  … ${body.length - MAX_HUNK_LINES} more lines`));
  return lines;
}

function byWorst(a: { f: AnnotatedFile; h: AnnotatedHunk }, b: { f: AnnotatedFile; h: AnnotatedHunk }): number {
  const w = (h: AnnotatedHunk) => Math.min(...h.flags.map((x) => FLAG_ORDER.indexOf(x.flag)));
  return w(a.h) - w(b.h) || a.f.path.localeCompare(b.f.path) || a.h.newStart - b.h.newStart;
}

function range(h: AnnotatedHunk): string {
  const seg = (s: number, n: number) => (n === 1 ? `${s}` : `${s},${n}`);
  return `@@ -${seg(h.oldStart, h.oldLines)} +${seg(h.newStart, h.newLines)} @@`;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s*\n\s*/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
