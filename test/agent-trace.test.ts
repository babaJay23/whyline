import { describe, it, expect } from 'vitest';
import { toAgentTrace } from '../src/export/agent-trace.js';
import { buildRecord } from '../src/record.js';
import type { AnnotatedDiff, Provenance } from '../src/types.js';

const p = (over: Partial<Provenance>): Provenance => ({
  harness: 'claude-code', sessionId: 's1', turnId: 't1', turnNumber: 4, agentId: 's1', agentName: null, agentBrief: null,
  prompt: { text: 'do it', at: 1 }, reasoning: null, tool: 'Edit', editId: 'e', at: 2, turnCost: null, turnModel: 'claude-opus-5', turnCostUsd: null, ...over,
});
const diff: AnnotatedDiff = {
  schemaVersion: 1, range: 'a..b', generatedAt: 0, sessions: [],
  files: [
    { path: 'src/a.ts', status: 'modified', turnIds: [], cost: null, costUsd: null, ledgerMismatch: false, driftedAt: null, hunks: [
      { oldStart: 1, oldLines: 1, newStart: 10, newLines: 3, removed: [], lines: [], lead: p({}), otherTurns: 0, flags: [{ flag: 'unrequested', detail: 'prompt named x' }] },
      { oldStart: 5, oldLines: 1, newStart: 20, newLines: 1, removed: [], lines: [], lead: p({}), otherTurns: 0, flags: [] },
      { oldStart: 9, oldLines: 2, newStart: 30, newLines: 0, removed: ['gone'], lines: [], lead: p({ turnId: 't2', turnNumber: 5, turnModel: 'gpt-5.5', harness: 'codex', sessionId: 'cx' }), otherTurns: 0, flags: [] },
      { oldStart: 1, oldLines: 0, newStart: 40, newLines: 2, removed: [], lines: [], lead: null, otherTurns: 0, flags: [{ flag: 'untraced', detail: 'no structured edit covers these lines' }] },
    ] },
  ],
  totals: { files: 1, hunks: 4, flagged: { untraced: 1, unrequested: 1, 'after-correction': 0, subagent: 0, churned: 0, drifted: 0 }, cost: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd: null, unpricedModels: [] },
};

describe('toAgentTrace', () => {
  const rec = buildRecord('c'.repeat(40), diff, { prompts: true, now: Date.parse('2026-10-15T12:00:00Z') });
  const t = toAgentTrace(rec, '00000000-0000-4000-8000-000000000000');

  it('has the required top-level shape', () => {
    expect(t).toMatchObject({ version: '0.1', id: '00000000-0000-4000-8000-000000000000', timestamp: '2026-10-15T12:00:00.000Z', vcs: { type: 'git', revision: 'c'.repeat(40) }, tool: { name: 'whyline' } });
    expect(t.tool.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('groups ranges per turn, maps models to provider ids, and keeps untraced hunks as unknown', () => {
    const [f] = t.files;
    expect(f!.path).toBe('src/a.ts');
    expect(f!.conversations).toEqual([
      { url: 'whyline://claude-code/s1/turn/4', contributor: { type: 'ai', model_id: 'anthropic/claude-opus-5' }, related: [{ type: 'prompt', url: 'whyline://claude-code/s1/turn/4#prompt' }], ranges: [{ start_line: 10, end_line: 12 }, { start_line: 20, end_line: 20 }] },
      { url: 'whyline://codex/cx/turn/5', contributor: { type: 'ai', model_id: 'openai/gpt-5.5' }, related: [{ type: 'prompt', url: 'whyline://codex/cx/turn/5#prompt' }], ranges: [] },
      { contributor: { type: 'unknown' }, ranges: [{ start_line: 40, end_line: 41 }] },
    ]);
  });

  it('keeps flags, prompts setting and cost in metadata', () => {
    expect(t.metadata.whyline.flags).toEqual([
      { path: 'src/a.ts', start_line: 10, end_line: 12, flag: 'unrequested', detail: 'prompt named x' },
      { path: 'src/a.ts', start_line: 40, end_line: 41, flag: 'untraced', detail: 'no structured edit covers these lines' },
    ]);
    expect(t.metadata.whyline.prompts).toBe(true);
    expect(t.metadata.whyline.cost.input).toBe(3);
  });

  it('omits model_id for an unknown provider', () => {
    const rec2 = buildRecord('d'.repeat(40), { ...diff, files: [{ ...diff.files[0]!, hunks: [{ ...diff.files[0]!.hunks[1]!, lead: p({ turnModel: 'codex-auto-review' }) }] }] }, { prompts: true, now: 0 });
    expect(toAgentTrace(rec2, 'x').files[0]!.conversations[0]!.contributor).toEqual({ type: 'ai' });
  });
});
