import type { AnnotatedDiff, AnnotatedFile, AnnotatedHunk, AnnotatedLine, EditEvent, FileDiff, Flag, Hunk, LineTable, Provenance, Session, Usage, Window } from '../types.js';
import { ZERO_USAGE, addUsage } from '../types.js';
import { replay, tableText } from '../ledger/ledger.js';
import { indexEvents, selectEdits, turnKey, type EventIndex, type Turn } from './index.js';
import { splitLines } from './diff.js';
import { FLAG_ORDER, flagHunk, type RepoFiles } from './flags.js';

export interface ResolveInput {
  repoRoot: string;
  range: string;
  window: Window;
  diffs: FileDiff[];
  sessions: Session[];
  baseText(path: string): string | null;
  headText(path: string): string | null;
  repo: RepoFiles;
}

export function resolve(input: ResolveInput): AnnotatedDiff {
  const ix = indexEvents(input.sessions, input.repoRoot);
  const files = input.diffs.map((d) => resolveFile(d, ix, input));
  const flagged = Object.fromEntries(FLAG_ORDER.map((f) => [f, 0])) as Record<Flag, number>;
  let hunks = 0;
  let cost: Usage = ZERO_USAGE;
  const costedTurns = new Set<string>();
  for (const f of files) {
    for (const h of f.hunks) {
      hunks++;
      for (const hit of h.flags) flagged[hit.flag]++;
      for (const l of h.lines) {
        const p = l.provenance;
        if (!p) continue;
        const key = turnKey(p.sessionId, p.turnId);
        if (costedTurns.has(key)) continue;
        costedTurns.add(key);
        const u = ix.turns.get(key)?.usage;
        if (u) cost = addUsage(cost, u);
      }
    }
  }
  return {
    schemaVersion: 1,
    range: input.range,
    generatedAt: Date.now(),
    sessions: input.sessions.map((s) => s.ref),
    files,
    totals: { files: files.length, hunks, flagged, cost },
  };
}

function resolveFile(d: FileDiff, ix: EventIndex, input: ResolveInput): AnnotatedFile {
  const edits = selectEdits(ix.editsByFile.get(d.path) ?? [], input.window);
  const base = d.status === 'added' ? null : input.baseText(d.oldPath ?? d.path);
  const table = replay(base, edits);
  const actual = d.status === 'deleted' ? '' : input.headText(d.path) ?? '';
  const ledgerMismatch = normalize(tableText(table)) !== normalize(actual);

  const used = new Set<number>();
  const hunks = d.hunks.map((h) => resolveHunk(h, d.path, table, edits, ix, input.repo, used));
  const keys = new Map<string, string>();
  for (const h of hunks) for (const l of h.lines) if (l.provenance) keys.set(turnKey(l.provenance.sessionId, l.provenance.turnId), l.provenance.turnId);
  let cost: Usage | null = null;
  for (const key of keys.keys()) {
    const u = ix.turns.get(key)?.usage;
    if (u) cost = addUsage(cost ?? ZERO_USAGE, u);
  }
  return { path: d.path, status: d.status, hunks, turnIds: [...keys.values()], cost, ledgerMismatch, driftedAt: table.driftedAt };
}

const NEAR = 3;

/**
 * Each diff line claims at most one ledger line: first the same position, then a
 * single matching line within NEAR of it. A duplicate typed by hand therefore
 * stays untraced instead of borrowing the agent's receipt.
 */
function resolveHunk(h: Hunk, file: string, table: LineTable, fileEdits: EditEvent[], ix: EventIndex, repo: RepoFiles, used: Set<number>): AnnotatedHunk {
  const lines: AnnotatedLine[] = h.added.map((text, i) => {
    const want = strip(text);
    const at = h.newStart - 1 + i;
    let idx: number | null = null;
    if (!used.has(at) && table.lines[at] && strip(table.lines[at]!.text) === want) idx = at;
    else {
      const near: number[] = [];
      for (let j = Math.max(0, at - NEAR); j <= Math.min(table.lines.length - 1, at + NEAR); j++) {
        if (!used.has(j) && strip(table.lines[j]!.text) === want) near.push(j);
      }
      if (near.length === 1) idx = near[0]!;
    }
    if (idx === null) return { text, provenance: null };
    used.add(idx);
    const editId = table.lines[idx]!.editId;
    const edit = editId ? fileEdits.find((e) => e.id === editId) ?? null : null;
    return { text, provenance: edit ? provenance(edit, ix) : null };
  });

  const lead = pickLead(lines) ?? (h.added.length === 0 ? removalLead(h.removed, fileEdits, ix) : null);
  const turnIds = new Set(lines.filter((l) => l.provenance).map((l) => turnKey(l.provenance!.sessionId, l.provenance!.turnId)));
  const otherTurns = Math.max(0, turnIds.size - (lead ? 1 : 0));
  const turn: Turn | null = lead ? ix.turns.get(turnKey(lead.sessionId, lead.turnId)) ?? null : null;
  const flags = flagHunk({ file, lines, lead, turn, table, fileEdits, shells: ix.shells, repo });

  return { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, removed: h.removed, lines, lead, otherTurns, flags };
}

/**
 * Removed lines are not in the ledger, so a hunk that only deletes is credited to
 * the last edit that deleted the file or whose replacement dropped exactly those lines.
 */
function removalLead(removed: string[], fileEdits: EditEvent[], ix: EventIndex): Provenance | null {
  const gone = removed.map(strip).join('\n');
  for (let i = fileEdits.length - 1; i >= 0; i--) {
    const e = fileEdits[i]!;
    if (e.op.type === 'delete') return provenance(e, ix);
    if (e.op.type === 'replace' && gone && e.op.old.includes(gone) && !e.op.new.includes(gone)) return provenance(e, ix);
  }
  return null;
}

function provenance(e: EditEvent, ix: EventIndex): Provenance {
  const turn = ix.turns.get(turnKey(e.sessionId, e.turnId));
  const before = turn?.reasoning.filter((r) => r.at <= e.at) ?? [];
  const reasoning = before.filter((r) => r.visible).at(-1) ?? before.at(-1) ?? null;
  const agentName = e.agentId === e.sessionId ? null : ix.agents.get(e.agentId)?.name ?? null;
  return {
    harness: ix.harnessOf.get(e.sessionId) ?? 'claude-code',
    sessionId: e.sessionId,
    turnId: e.turnId,
    agentId: e.agentId,
    agentName,
    prompt: turn?.prompt ? { text: turn.prompt.text, at: turn.prompt.at } : { text: '', at: turn?.firstAt ?? e.at },
    reasoning: reasoning ? { text: reasoning.text, at: reasoning.at } : null,
    tool: e.tool,
    editId: e.id,
    at: e.at,
    turnCost: turn?.usage ?? null,
  };
}

function pickLead(lines: AnnotatedLine[]): Provenance | null {
  const counts = new Map<string, { p: Provenance; n: number }>();
  for (const l of lines) {
    if (!l.provenance) continue;
    const k = `${l.provenance.turnId}\u0000${l.provenance.editId}`;
    const c = counts.get(k) ?? { p: l.provenance, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  let best: { p: Provenance; n: number } | null = null;
  for (const c of counts.values()) {
    if (!best || c.n > best.n || (c.n === best.n && c.p.at < best.p.at)) best = c;
  }
  return best?.p ?? null;
}

function strip(s: string): string {
  return s.endsWith('\r') ? s.slice(0, -1) : s;
}

/** Line-wise comparison that ignores a missing final newline and CRLF endings. */
function normalize(s: string): string {
  return splitLines(s).map(strip).join('\n');
}
