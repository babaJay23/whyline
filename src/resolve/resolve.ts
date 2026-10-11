import type { AnnotatedDiff, AnnotatedFile, AnnotatedHunk, AnnotatedLine, EditEvent, FileDiff, Flag, Hunk, LineTable, Provenance, Session, Usage, Window } from '../types.js';
import { ZERO_USAGE, addUsage } from '../types.js';
import { replay, tableText } from '../ledger/ledger.js';
import { indexEvents, selectEdits, type EventIndex, type Turn } from './index.js';
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
    }
    for (const t of f.turnIds) {
      if (costedTurns.has(t)) continue;
      costedTurns.add(t);
      const u = ix.turns.get(t)?.usage;
      if (u) cost = addUsage(cost, u);
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
  const ledgerMismatch = strip(tableText(table)) !== strip(actual);

  const hunks = d.hunks.map((h) => resolveHunk(h, d.path, table, edits, ix, input.repo));
  const turnIds = [...new Set(hunks.flatMap((h) => h.lines.map((l) => l.provenance?.turnId)).filter((t): t is string => !!t))];
  let cost: Usage | null = null;
  for (const t of turnIds) {
    const u = ix.turns.get(t)?.usage;
    if (u) cost = addUsage(cost ?? ZERO_USAGE, u);
  }
  return { path: d.path, status: d.status, hunks, turnIds, cost, ledgerMismatch, driftedAt: table.driftedAt };
}

function resolveHunk(h: Hunk, file: string, table: LineTable, fileEdits: EditEvent[], ix: EventIndex, repo: RepoFiles): AnnotatedHunk {
  const byText = new Map<string, number[]>();
  table.lines.forEach((l, i) => {
    const k = strip(l.text);
    const arr = byText.get(k) ?? [];
    arr.push(i);
    byText.set(k, arr);
  });

  const lines: AnnotatedLine[] = h.added.map((text, i) => {
    const want = strip(text);
    const at = h.newStart - 1 + i;
    let idx: number | null = null;
    if (table.lines[at] && strip(table.lines[at]!.text) === want) idx = at;
    else {
      const cands = byText.get(want);
      if (cands && cands.length === 1) idx = cands[0]!;
    }
    const editId = idx === null ? null : table.lines[idx]!.editId;
    const edit = editId ? fileEdits.find((e) => e.id === editId) ?? null : null;
    return { text, provenance: edit ? provenance(edit, ix) : null };
  });

  const lead = pickLead(lines);
  const turnIds = new Set(lines.map((l) => l.provenance?.turnId).filter(Boolean));
  const otherTurns = Math.max(0, turnIds.size - (lead ? 1 : 0));
  const turn: Turn | null = lead ? ix.turns.get(lead.turnId) ?? null : null;
  const flags = flagHunk({ file, lines, lead, turn, table, fileEdits, shells: ix.shells, repo });

  return { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, removed: h.removed, lines, lead, otherTurns, flags };
}

function provenance(e: EditEvent, ix: EventIndex): Provenance {
  const turn = ix.turns.get(e.turnId);
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
