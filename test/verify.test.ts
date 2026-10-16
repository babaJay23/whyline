import { describe, it, expect } from 'vitest';
import { makeRepo } from './helpers/tmp-repo.js';
import { verifyCommits } from '../src/verify.js';
import { noteAdd } from '../src/git.js';
import { buildRecord } from '../src/record.js';
import type { AnnotatedDiff } from '../src/types.js';

const empty: AnnotatedDiff = { schemaVersion: 1, range: 'r', generatedAt: 0, sessions: [], files: [], totals: { files: 0, hunks: 0, flagged: { untraced: 0, unrequested: 0, 'after-correction': 0, subagent: 0, churned: 0, drifted: 0 }, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: null, unpricedModels: [] } };

describe('verifyCommits', () => {
  it('reports missing, ok, and tampered records', () => {
    const r = makeRepo({ f: '1\n' });
    const a = r.commit('a');
    r.write('f', '2\n'); const b = r.commit('b');
    r.write('f', '3\n'); const c = r.commit('c');
    noteAdd(r.dir, b, JSON.stringify(buildRecord(b, empty, { prompts: true, now: 0 })));
    const tampered = buildRecord(c, empty, { prompts: true, now: 0 });
    noteAdd(r.dir, c, JSON.stringify({ ...tampered, prompts: false }));
    expect(verifyCommits(r.dir, [a, b, c])).toEqual([
      { sha: a, attached: false, hash: null, signature: null },
      { sha: b, attached: true, hash: 'ok', signature: 'unsigned' },
      { sha: c, attached: true, hash: 'mismatch', signature: 'unsigned' },
    ]);
  });

  it('defers signature checking to the injected verifier', () => {
    const r = makeRepo({ f: '1\n' });
    const a = r.commit('a');
    const rec = buildRecord(a, empty, { prompts: true, now: 0 });
    noteAdd(r.dir, a, JSON.stringify({ ...rec, signature: { format: 'ssh', signer: 'me@x', namespace: 'whyline', sig: 'SIG' } }));
    expect(verifyCommits(r.dir, [a], { verifySig: () => true })[0]!.signature).toEqual({ signer: 'me@x' });
    expect(verifyCommits(r.dir, [a], { verifySig: () => false })[0]!.signature).toBe('bad');
    expect(verifyCommits(r.dir, [a])[0]!.signature).toBeNull();
  });
});
