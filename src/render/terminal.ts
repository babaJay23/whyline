import type { AnnotatedDiff, Usage } from '../types.js';
import { FLAG_ORDER } from '../resolve/flags.js';
import { paint } from './ansi.js';
import { groupHunks, oneLine, plural, range, stamp, who, type Entry, type Group } from './groups.js';

export const MAX_HUNK_LINES = 40;
export const MISMATCH_NOTE = 'file differs from what the recorded edits produce; some lines were changed another way';

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
  const { groups, unflagged } = groupHunks(d, { all: opts.all });

  for (const g of groups) out.push(...groupBlock(g, c), '');

  if (!opts.all && unflagged.length) {
    out.push(c.dim('unflagged:'));
    for (const f of d.files) {
      const n = unflagged.filter((e) => e.f === f).length;
      if (n === 0) continue;
      out.push(c.dim(`  ${f.path}  ${n} ${plural(n, 'hunk')}  ${f.turnIds.length} ${plural(f.turnIds.length, 'turn')}  ${fmtTokens(f.cost)} tokens`));
    }
    out.push('');
  }
  return out.join('\n');
}

function groupBlock(g: Group, c: ReturnType<typeof paint>): string[] {
  const lines: string[] = [];
  const p = g.lead;
  if (p) {
    lines.push(c.bold(`turn ${p.turnNumber} · ${p.harness} · ${who(p)} · ${stamp(p.at)} · ${fmtTokens(p.turnCost)} tokens`));
    if (p.agentBrief) lines.push(`  brief: ${oneLine(p.agentBrief, 120)}`);
    lines.push(`  you asked: ${oneLine(p.prompt.text, 120)}`);
    if (p.reasoning) lines.push(c.dim(`  agent said: ${oneLine(p.reasoning.text, 160)}`));
  } else {
    lines.push(c.bold('no turn found'));
  }
  let said = p?.reasoning?.text ?? null;
  for (const e of g.entries) {
    const own = e.h.lead?.reasoning?.text ?? null;
    lines.push(...hunkBlock(e, own !== null && own !== said ? own : null, c));
    if (own !== null) said = own;
  }
  return lines;
}

function hunkBlock({ f, h }: Entry, said: string | null, c: ReturnType<typeof paint>): string[] {
  const lines: string[] = [`  ${c.bold(f.path)} ${c.cyan(range(h))}`];
  for (const fl of h.flags) lines.push(`    ${c.red('!')} ${c.yellow(fl.flag)}  ${fl.detail}`);
  if (f.ledgerMismatch) lines.push(c.dim(`    ${MISMATCH_NOTE}`));
  // Only say what the agent said when it changed since the last hunk shown.
  if (said !== null) lines.push(c.dim(`    agent said: ${oneLine(said, 160)}`));
  if (h.otherTurns > 0) lines.push(c.dim(`    (+${h.otherTurns} other ${plural(h.otherTurns, 'turn')})`));
  const body = [...h.removed.map((r) => c.red(`  -${r}`)), ...h.lines.map((l) => c.green(`  +${l.text}`))];
  lines.push(...body.slice(0, MAX_HUNK_LINES));
  if (body.length > MAX_HUNK_LINES) lines.push(c.dim(`    … ${body.length - MAX_HUNK_LINES} more lines`));
  return lines;
}
