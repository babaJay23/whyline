import { describe, it, expect } from 'vitest';
import { canonicalJson, hashOf, buildRecord, blankPrompts, parseRecord } from '../src/record.js';
import type { AnnotatedDiff, Provenance } from '../src/types.js';

const prov: Provenance = {
  harness: 'claude-code', sessionId: 's1', turnId: 't1', turnNumber: 1, agentId: 'abc', agentName: 'helper', agentBrief: 'write it',
  prompt: { text: 'add the thing', at: 1 }, reasoning: { text: 'Adding.', at: 2 }, tool: 'Edit', editId: 'e1', at: 3,
  turnCost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, turnModel: 'claude-opus-5', turnCostUsd: null,
};
const diff: AnnotatedDiff = {
  schemaVersion: 1, range: 'a..b', generatedAt: 10, sessions: [],
  files: [{ path: 'f.ts', status: 'modified', turnIds: ['t1'], cost: null, costUsd: null, ledgerMismatch: false, driftedAt: null,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, removed: ['a'], lines: [{ text: 'b', provenance: prov }], lead: prov, otherTurns: 0,
      flags: [{ flag: 'after-correction', detail: 'prompt begins "add the thing"' }] }] }],
  totals: { files: 1, hunks: 1, flagged: { untraced: 0, unrequested: 0, 'after-correction': 1, unspecified: 0, subagent: 0, churned: 0, drifted: 0 }, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd: null, unpricedModels: [] },
};

describe('canonicalJson', () => {
  it('sorts keys recursively and strips whitespace', () => {
    expect(canonicalJson({ b: [{ z: 1, a: 2 }], a: 'x' })).toBe('{"a":"x","b":[{"a":2,"z":1}]}');
  });
  it('is stable under key order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe('hashOf', () => {
  it('prefixes sha256 and changes when any field changes', () => {
    const base = { commit: 'c', createdAt: 't', prompts: true, record: diff };
    const h = hashOf(base);
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashOf({ ...base, commit: 'd' })).not.toBe(h);
    expect(hashOf({ ...base, record: { ...diff, generatedAt: 11 } })).not.toBe(h);
  });
});

describe('buildRecord', () => {
  it('fills metadata and hashes the content', () => {
    const r = buildRecord('abc', diff, { prompts: true, now: Date.parse('2026-10-15T00:00:00Z') });
    expect(r).toMatchObject({ schemaVersion: 1, commit: 'abc', createdAt: '2026-10-15T00:00:00.000Z', prompts: true, signature: null });
    expect(r.hash).toBe(hashOf(r));
    expect(r.record).toBe(diff);
  });
  it('blanks prompts when asked and the hash covers the blanked content', () => {
    const r = buildRecord('abc', diff, { prompts: false, now: 0 });
    expect(r.prompts).toBe(false);
    const p = r.record.files[0]!.hunks[0]!.lead!;
    expect([p.prompt.text, p.reasoning?.text, p.agentBrief]).toEqual(['', '', '']);
    expect(r.record.files[0]!.hunks[0]!.flags[0]!.detail).toBe('prompt text not recorded');
    expect(r.hash).toBe(hashOf(r));
  });
});

describe('blankPrompts', () => {
  it('does not mutate its input', () => {
    blankPrompts(diff);
    expect(diff.files[0]!.hunks[0]!.lead!.prompt.text).toBe('add the thing');
  });
});

describe('parseRecord', () => {
  it('round-trips and rejects garbage', () => {
    const r = buildRecord('abc', diff, { prompts: true, now: 0 });
    expect(parseRecord(JSON.stringify(r))).toEqual(r);
    expect(parseRecord('not json')).toBeNull();
    expect(parseRecord(JSON.stringify({ ...r, schemaVersion: 2 }))).toBeNull();
    expect(parseRecord(JSON.stringify({ hello: 1 }))).toBeNull();
  });
});
