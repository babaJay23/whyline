import { describe, it, expect } from 'vitest';
import { mergeRecords } from '../src/merge.js';
import { buildRecord } from '../src/record.js';
import type { AnnotatedDiff } from '../src/types.js';

const mk = (path: string, flag: 'untraced' | null, cost: number | null, sessionId: string): AnnotatedDiff => ({
  schemaVersion: 1, range: 'x', generatedAt: 0,
  sessions: [{ harness: 'claude-code', id: sessionId, path: '/p', cwd: '/r', startedAt: 0, endedAt: 1 }],
  files: [{ path, status: 'modified', turnIds: [], cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: cost, ledgerMismatch: false, driftedAt: null,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, removed: [], lines: [{ text: 'x', provenance: null }], lead: null, otherTurns: 0, flags: flag ? [{ flag, detail: 'd' }] : [] }] }],
  totals: { files: 1, hunks: 1, flagged: { untraced: flag ? 1 : 0, unrequested: 0, 'after-correction': 0, subagent: 0, churned: 0, drifted: 0 }, cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: cost, unpricedModels: cost === null ? ['m'] : [] },
});

describe('mergeRecords', () => {
  it('concatenates files tagged with their commit and recomputes totals', () => {
    const a = buildRecord('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mk('a.ts', 'untraced', 0.5, 's1'), { prompts: true, now: 0 });
    const b = buildRecord('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', mk('b.ts', null, 0.25, 's1'), { prompts: true, now: 0 });
    const m = mergeRecords([a, b], 'x..y', 42);
    expect(m.files.map((f) => [f.path, f.commit])).toEqual([['a.ts', 'aaaaaaa'], ['b.ts', 'bbbbbbb']]);
    expect(m.totals).toMatchObject({ files: 2, hunks: 2, cost: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0.75 });
    expect(m.totals.flagged.untraced).toBe(1);
    expect(m.sessions).toHaveLength(1);
    expect(m.range).toBe('x..y');
    expect(m.generatedAt).toBe(42);
  });

  it('drops the dollar total when any record lacks one and unions unpriced models', () => {
    const a = buildRecord('a'.repeat(40), mk('a.ts', null, 0.5, 's1'), { prompts: true, now: 0 });
    const b = buildRecord('b'.repeat(40), mk('b.ts', null, null, 's2'), { prompts: true, now: 0 });
    const m = mergeRecords([a, b], 'r', 0);
    expect(m.totals.costUsd).toBeNull();
    expect(m.totals.unpricedModels).toEqual(['m']);
    expect(m.sessions.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});
