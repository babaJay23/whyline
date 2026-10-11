import type { AnnotatedDiff, AnnotatedFile, AnnotatedHunk, Provenance } from '../types.js';
import { FLAG_ORDER } from '../resolve/flags.js';

export interface Entry {
  f: AnnotatedFile;
  h: AnnotatedHunk;
  id: string; // stable anchor: h-<file index>-<hunk index>
}

/** Hunks that came from the same turn of the same agent, so the ask is shown once. */
export interface Group {
  lead: Provenance | null;
  entries: Entry[];
}

export function worst(h: AnnotatedHunk): number {
  return h.flags.length ? Math.min(...h.flags.map((x) => FLAG_ORDER.indexOf(x.flag))) : FLAG_ORDER.length;
}

function byWorst(a: Entry, b: Entry): number {
  return worst(a.h) - worst(b.h) || a.f.path.localeCompare(b.f.path) || a.h.newStart - b.h.newStart;
}

/**
 * Group hunks by (session, turn, agent). Groups are ordered by their worst flag,
 * then by time; hunks inside a group are ordered the same way. A group whose
 * lead is null collects hunks no turn accounts for and sorts as untraced.
 */
export function groupHunks(d: AnnotatedDiff, opts: { all: boolean }): { groups: Group[]; unflagged: Entry[] } {
  const entries = d.files.flatMap((f, fi) => f.hunks.map((h, hi) => ({ f, h, id: `h-${fi}-${hi}` })));
  const shown = opts.all ? entries : entries.filter((e) => e.h.flags.length > 0);
  const unflagged = entries.filter((e) => e.h.flags.length === 0);

  const map = new Map<string, Group>();
  for (const e of shown) {
    const p = e.h.lead;
    const key = p ? `${p.sessionId}\u0000${p.turnId}\u0000${p.agentId}` : '';
    const g = map.get(key) ?? { lead: p, entries: [] };
    g.entries.push(e);
    map.set(key, g);
  }
  const groups = [...map.values()];
  for (const g of groups) g.entries.sort(byWorst);
  groups.sort((a, b) => {
    const wa = Math.min(...a.entries.map((e) => worst(e.h)));
    const wb = Math.min(...b.entries.map((e) => worst(e.h)));
    return wa - wb || (a.lead?.at ?? 0) - (b.lead?.at ?? 0);
  });
  return { groups, unflagged };
}

export function who(p: Provenance): string {
  return p.agentId === p.sessionId ? 'main agent' : `subagent ${p.agentName ?? p.agentId}`;
}

export function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

export function oneLine(s: string, max: number): string {
  const t = s.replace(/\s*\n\s*/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function range(h: AnnotatedHunk): string {
  const seg = (s: number, n: number) => (n === 1 ? `${s}` : `${s},${n}`);
  return `@@ -${seg(h.oldStart, h.oldLines)} +${seg(h.newStart, h.newLines)} @@`;
}

export function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
