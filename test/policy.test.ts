import { describe, it, expect } from 'vitest';
import { parsePolicy, evaluate } from '../src/policy.js';
import type { AnnotatedDiff, AnnotatedHunk, Provenance } from '../src/types.js';

const prov: Provenance = {
  harness: 'claude-code', sessionId: 's1', turnId: 'p3', turnNumber: 3, agentId: 's1', agentName: null, agentBrief: null,
  prompt: { text: "no, don't touch the readme.\nput the docs in docs/notes.md instead", at: Date.parse('2026-10-01T10:00:08Z') },
  reasoning: { text: 'Moving the notes.', at: 0 }, tool: 'Write', editId: 'toolu_4', at: Date.parse('2026-10-01T10:00:10Z'),
  turnCost: { input: 30, output: 8, cacheRead: 1200, cacheWrite: 0 }, turnModel: 'claude-opus-5', turnCostUsd: 0.001,
};
const flagged: AnnotatedHunk = {
  oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, removed: [], lines: [{ text: '# notes', provenance: prov }],
  lead: prov, otherTurns: 0, flags: [{ flag: 'unrequested', detail: 'prompt named README.md' }, { flag: 'after-correction', detail: 'prompt begins "no, don\'t touch the readme."' }],
};
const plain: AnnotatedHunk = {
  oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, removed: ['two'], lines: [{ text: '2', provenance: { ...prov, turnId: 'p1', turnNumber: 1, turnCost: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 }, turnCostUsd: 0.001 } }],
  lead: { ...prov, turnId: 'p1', turnNumber: 1, turnCost: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 }, turnCostUsd: 0.001 }, otherTurns: 0, flags: [],
};
const untraced: AnnotatedHunk = {
  oldStart: 5, oldLines: 0, newStart: 6, newLines: 2, removed: [], lines: [{ text: 'x', provenance: null }, { text: 'y', provenance: null }],
  lead: null, otherTurns: 0, flags: [{ flag: 'untraced', detail: 'no structured edit covers these lines' }],
};
const diff: AnnotatedDiff = {
  schemaVersion: 1, range: 'HEAD..working tree', generatedAt: 0,
  sessions: [{ harness: 'claude-code', id: 's1', path: '/x', cwd: '/repo', startedAt: 0, endedAt: 1 }],
  files: [
    { path: 'docs/notes.md', status: 'added', hunks: [flagged], turnIds: ['p3'], cost: prov.turnCost, costUsd: 0.001, ledgerMismatch: false, driftedAt: null },
    { path: 'src/a.ts', status: 'modified', hunks: [plain, untraced], turnIds: ['p1'], cost: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 }, costUsd: 0.001, ledgerMismatch: true, driftedAt: null },
  ],
  totals: { files: 2, hunks: 3, flagged: { untraced: 1, unrequested: 1, 'after-correction': 1, unspecified: 0, subagent: 0, churned: 0, drifted: 0 }, cost: { input: 130, output: 28, cacheRead: 1200, cacheWrite: 0 }, costUsd: 0.002, unpricedModels: [] },
};

describe('parsePolicy', () => {
  it('accepts known keys and rejects unknown or mistyped ones', () => {
    expect(parsePolicy('{"forbid":["unrequested"],"maxUntracedRatio":0.2}')).toEqual({ forbid: ['unrequested'], maxUntracedRatio: 0.2 });
    expect(parsePolicy('{"forbid":["nope"]}')).toMatch(/forbid/);
    expect(parsePolicy('{"maxUntracedRatio":"a lot"}')).toMatch(/maxUntracedRatio/);
    expect(parsePolicy('{"bogus":1}')).toMatch(/bogus/);
    expect(parsePolicy('{')).toMatch(/JSON/);
  });
});

describe('evaluate', () => {
  it('passes an empty policy and counts violations per rule', () => {
    expect(evaluate(diff, null, {})).toEqual([]);
    expect(evaluate(diff, null, { forbid: ['unrequested', 'churned'] })).toEqual([{ rule: 'forbid', detail: '1 unrequested hunk' }]);
    expect(evaluate(diff, null, { maxUntracedRatio: 0.5 })).toEqual([]);
    expect(evaluate(diff, null, { maxUntracedRatio: 0.1 })).toEqual([{ rule: 'maxUntracedRatio', detail: '1 of 3 hunks untraced (33%), limit 10%' }]);
    expect(evaluate(diff, null, { requireRecords: true })).toEqual([{ rule: 'requireRecords', detail: 'no attached records (local diff)' }]);
  });

  it('checks records and signatures from verify results', () => {
    const v = [
      { sha: 'a'.repeat(40), attached: true, hash: 'ok' as const, signature: { signer: 'dev@example.com' } },
      { sha: 'b'.repeat(40), attached: false, hash: null, signature: null },
      { sha: 'c'.repeat(40), attached: true, hash: 'ok' as const, signature: 'unsigned' as const },
    ];
    expect(evaluate(diff, v, { requireRecords: true })).toEqual([{ rule: 'requireRecords', detail: 'missing or altered: bbbbbbb' }]);
    expect(evaluate(diff, v, { requireSignature: true })).toEqual([{ rule: 'requireSignature', detail: 'unsigned or bad: bbbbbbb, ccccccc' }]); // a missing record is unsigned too
    expect(evaluate(diff, v, { allowedSigners: ['other@example.com'] })).toEqual([{ rule: 'allowedSigners', detail: 'dev@example.com signed aaaaaaa' }]);
    expect(evaluate(diff, v, { allowedSigners: ['dev@example.com'] })).toEqual([]);
  });

  it('requires a brief on subagent hunks', () => {
    const sub = { ...diff, files: [{ ...diff.files[0]!, hunks: [{ ...flagged, lead: { ...prov, agentId: 'abc', agentName: 'helper', agentBrief: '' }, flags: [{ flag: 'subagent' as const, detail: 'helper' }] }] }] };
    expect(evaluate(sub, null, { subagentNeedsBrief: true })).toEqual([{ rule: 'subagentNeedsBrief', detail: '1 subagent hunk without a brief' }]);
  });
});
