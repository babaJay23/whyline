import { noteShow } from './git.js';
import { parseRecord, type IntentRecord } from './record.js';
import type { AnnotatedDiff, Flag, Usage } from './types.js';
import { ZERO_USAGE, addUsage } from './types.js';
import { FLAG_ORDER } from './resolve/flags.js';

export function readRecords(root: string, shas: string[]): { records: IntentRecord[]; missing: string[]; invalid: string[] } {
  const records: IntentRecord[] = [];
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const sha of shas) {
    const text = noteShow(root, sha);
    if (text === null) { missing.push(sha); continue; }
    const rec = parseRecord(text);
    if (!rec) { invalid.push(sha); continue; }
    records.push(rec);
  }
  return { records, missing, invalid };
}

/** One review out of several commits' records: files keep their own line numbers and carry their commit. */
export function mergeRecords(records: IntentRecord[], range: string, now: number): AnnotatedDiff {
  const files = records.flatMap((r) => r.record.files.map((f) => ({ ...f, commit: r.commit.slice(0, 7) })));
  const flagged = Object.fromEntries(FLAG_ORDER.map((f) => [f, 0])) as Record<Flag, number>;
  let hunks = 0;
  for (const f of files) for (const h of f.hunks) { hunks++; for (const x of h.flags) flagged[x.flag]++; }
  let cost: Usage = ZERO_USAGE;
  let costUsd: number | null = 0;
  const unpriced = new Set<string>();
  for (const r of records) {
    cost = addUsage(cost, r.record.totals.cost);
    if (r.record.totals.costUsd === null) costUsd = null;
    else if (costUsd !== null) costUsd += r.record.totals.costUsd;
    for (const m of r.record.totals.unpricedModels) unpriced.add(m);
  }
  const sessions = [...new Map(records.flatMap((r) => r.record.sessions).map((s) => [s.id, s])).values()];
  return {
    schemaVersion: 1, range, generatedAt: now, sessions, files,
    totals: { files: files.length, hunks, flagged, cost, costUsd, unpricedModels: [...unpriced].sort() },
  };
}
