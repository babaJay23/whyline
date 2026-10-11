import { describe, it, expect } from 'vitest';
import { resolve } from '../src/resolve/resolve.js';
import { syntheticAdded, parseUnifiedDiff } from '../src/resolve/diff.js';
import type { RepoFiles } from '../src/resolve/flags.js';
import type { Event, Session, SessionRef } from '../src/types.js';

const ref: SessionRef = { harness: 'claude-code', id: 's1', path: '/x', cwd: '/repo', startedAt: 100, endedAt: 900 };
const base = { sessionId: 's1', agentId: 's1' };

function session(events: Event[]): Session {
  return { ref, events, skipped: 0 };
}
const repoOf = (files: Record<string, string>): RepoFiles => ({
  has: (p) => p in files,
  byBasename: (n) => Object.keys(files).filter((p) => p.split('/').pop() === n),
  read: (p) => files[p] ?? null,
});

describe('resolve', () => {
  const beforeA = 'one\ntwo\nthree\n';
  const afterA = 'one\n2\nthree\n';
  const events: Event[] = [
    { kind: 'prompt', id: 'p1', ...base, turnId: 't1', at: 200, text: 'change two to 2 in a.ts' },
    { kind: 'reasoning', id: 'r1', ...base, turnId: 't1', at: 210, text: 'Replacing two with 2.', visible: true },
    { kind: 'edit', id: 'e1', ...base, turnId: 't1', at: 220, tool: 'Edit', file: '/repo/a.ts', op: { type: 'replace', old: 'two', new: '2', all: false } },
    { kind: 'usage', id: 'u1', ...base, turnId: 't1', at: 230, input: 10, output: 5, cacheRead: 0, cacheWrite: 0, model: 'claude-opus-5' },
  ];
  const diff = parseUnifiedDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2 +2 @@\n-two\n+2\n');

  const run = (extra: Partial<Parameters<typeof resolve>[0]> = {}) =>
    resolve({
      repoRoot: '/repo', range: 'HEAD..working tree', window: { from: 100, to: 1000 },
      diffs: diff, sessions: [session(events)],
      baseText: (p) => (p === 'a.ts' ? beforeA : null), headText: (p) => (p === 'a.ts' ? afterA : null),
      repo: repoOf({ 'a.ts': afterA }), ...extra,
    });

  it('attributes a changed line to the edit, prompt, reasoning and cost of its turn', () => {
    const out = run({ now: 12345 });
    expect(out.schemaVersion).toBe(1);
    expect(out.generatedAt).toBe(12345);
    const [file] = out.files;
    expect(file!.path).toBe('a.ts');
    const [hunk] = file!.hunks;
    expect(hunk!.lines).toHaveLength(1);
    const p = hunk!.lines[0]!.provenance!;
    expect(p).toMatchObject({ harness: 'claude-code', sessionId: 's1', turnId: 't1', turnNumber: 1, agentId: 's1', agentName: null, tool: 'Edit', editId: 'e1', at: 220 });
    expect(p.prompt.text).toBe('change two to 2 in a.ts');
    expect(p.reasoning?.text).toBe('Replacing two with 2.');
    expect(p.turnCost).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
    expect(hunk!.lead).toEqual(p);
    expect(p.turnModel).toBe('claude-opus-5');
    expect(p.turnCostUsd).toBeCloseTo((10 * 5 + 5 * 25) / 1e6, 10);
    expect(file!.costUsd).toBeCloseTo(p.turnCostUsd!, 10);
    expect(out.totals.costUsd).toBeCloseTo(p.turnCostUsd!, 10);
    expect(out.totals.unpricedModels).toEqual([]);
    expect(hunk!.flags).toEqual([]);
    expect(file!.cost).toEqual(p.turnCost);
    expect(file!.ledgerMismatch).toBe(false);
    expect(out.totals).toEqual({ files: 1, hunks: 1, flagged: { untraced: 0, unrequested: 0, 'after-correction': 0, subagent: 0, churned: 0, drifted: 0 }, cost: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } });
  });

  it('ignores edits outside the window and reports the line untraced', () => {
    const out = run({ window: { from: 500, to: 1000 } });
    expect(out.files[0]!.hunks[0]!.lines[0]!.provenance).toBeNull();
    expect(out.files[0]!.hunks[0]!.flags.map((f) => f.flag)).toEqual(['untraced']);
    expect(out.totals.flagged.untraced).toBe(1);
  });

  it('marks ledgerMismatch when the working file differs from the replayed table', () => {
    const out = run({ headText: () => 'one\n2\nthree\nextra by hand\n' });
    expect(out.files[0]!.ledgerMismatch).toBe(true);
    expect(out.files[0]!.hunks[0]!.lines[0]!.provenance).not.toBeNull(); // the matching line still resolves
  });

  it('resolves an untracked new file written by the agent', () => {
    const content = 'export const n = 1;\n';
    const evs: Event[] = [
      { kind: 'prompt', id: 'p', ...base, turnId: 't1', at: 200, text: 'create n.ts' },
      { kind: 'edit', id: 'w1', ...base, turnId: 't1', at: 210, tool: 'Write', file: '/repo/n.ts', op: { type: 'write', content } },
    ];
    const out = run({ diffs: [syntheticAdded('n.ts', content)], sessions: [session(evs)], baseText: () => null, headText: () => content, repo: repoOf({ 'n.ts': content }) });
    expect(out.files[0]!.hunks[0]!.lines[0]!.provenance?.editId).toBe('w1');
  });

  it('matches lines whose position shifted when the text is unique', () => {
    const out = run({ headText: () => 'inserted by hand\none\n2\nthree\n', diffs: parseUnifiedDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+inserted by hand\n@@ -2 +3 @@\n-two\n+2\n') });
    const [h1, h2] = out.files[0]!.hunks;
    expect(h1!.lines[0]!.provenance).toBeNull();
    expect(h2!.lines[0]!.provenance?.editId).toBe('e1');
  });

  it('compares CRLF lines after stripping one trailing \\r', () => {
    const out = run({
      baseText: () => 'one\r\ntwo\r\nthree\r\n', headText: () => 'one\r\n2\r\nthree\r\n',
      sessions: [session([{ ...events[2]!, op: { type: 'replace', old: 'two', new: '2', all: false } } as Event, events[0]!])],
      diffs: parseUnifiedDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2 +2 @@\n-two\r\n+2\r\n'),
    });
    expect(out.files[0]!.hunks[0]!.lines[0]!.provenance?.editId).toBe('e1');
  });

  it('does not attribute a hand-written duplicate of an agent line to the agent', () => {
    const out = run({ headText: () => 'one\n2\nthree\n2\n', diffs: parseUnifiedDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2 +2 @@\n-two\n+2\n@@ -3,0 +4 @@\n+2\n') });
    const [h1, h2] = out.files[0]!.hunks;
    expect(h1!.lines[0]!.provenance?.editId).toBe('e1');
    expect(h2!.lines[0]!.provenance).toBeNull();
    expect(out.files[0]!.ledgerMismatch).toBe(true);
  });

  it('only matches shifted lines within three lines of their position', () => {
    const far = 'p\nq\nr\ns\nt\none\n2\nthree\n';
    const out = run({ headText: () => far, diffs: parseUnifiedDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,5 @@\n+p\n+q\n+r\n+s\n+t\n@@ -2 +7 @@\n-two\n+2\n') });
    expect(out.files[0]!.hunks[1]!.lines[0]!.provenance).toBeNull(); // shifted by 5, too far to trust
  });

  it('does not report a mismatch for a file without a trailing newline', () => {
    const out = run({ baseText: () => 'one\ntwo\nthree', headText: () => 'one\n2\nthree' });
    expect(out.files[0]!.ledgerMismatch).toBe(false);
  });

  it('keeps turns from different sessions apart even when their ids collide', () => {
    const other: SessionRef = { ...ref, id: 's2', harness: 'codex' };
    const evs2: Event[] = [
      { kind: 'prompt', id: 'p', sessionId: 's2', agentId: 's2', turnId: 't1', at: 300, text: 'write n.ts' },
      { kind: 'edit', id: 'w2', sessionId: 's2', agentId: 's2', turnId: 't1', at: 310, tool: 'apply_patch', file: '/repo/n.ts', op: { type: 'write', content: 'n\n' } },
      { kind: 'usage', id: 'u2', sessionId: 's2', agentId: 's2', turnId: 't1', at: 320, input: 7, output: 7, cacheRead: 0, cacheWrite: 0 },
    ];
    const out = run({
      diffs: [...diff, syntheticAdded('n.ts', 'n\n')],
      sessions: [session(events), { ref: other, events: evs2, skipped: 0 }],
      headText: (p) => (p === 'a.ts' ? afterA : 'n\n'),
      repo: repoOf({ 'a.ts': afterA, 'n.ts': 'n\n' }),
    });
    const [a, n] = out.files;
    expect(a!.hunks[0]!.lead?.turnCost).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
    expect(n!.hunks[0]!.lead).toMatchObject({ harness: 'codex', sessionId: 's2', turnCost: { input: 7, output: 7, cacheRead: 0, cacheWrite: 0 } });
    expect(n!.hunks[0]!.lead?.prompt.text).toBe('write n.ts');
    expect(out.totals.cost).toEqual({ input: 17, output: 12, cacheRead: 0, cacheWrite: 0 });
  });

  it('shows the turn of the shell command that touched an untraced file, without attributing its lines', () => {
    const evs: Event[] = [
      { kind: 'prompt', id: 'p1', ...base, turnId: 't1', at: 200, text: 'write the cli entry point' },
      { kind: 'reasoning', id: 'r1', ...base, turnId: 't1', at: 205, text: 'Writing src/cli.ts with a heredoc.', visible: true },
      { kind: 'shell', id: 'sh1', ...base, turnId: 't1', at: 210, command: "cat > src/cli.ts <<'EOF'\nmain()\nEOF", touches: ['src/cli.ts'] },
      { kind: 'usage', id: 'u1', ...base, turnId: 't1', at: 220, input: 9, output: 9, cacheRead: 0, cacheWrite: 0 },
      { kind: 'shell', id: 'sh0', ...base, turnId: 't0', at: 50, command: 'touch src/cli.ts', touches: ['src/cli.ts'] }, // before the window
    ];
    const out = run({ diffs: [syntheticAdded('src/cli.ts', 'main()\n')], sessions: [session(evs)], baseText: () => null, headText: () => 'main()\n', repo: repoOf({ 'src/cli.ts': 'main()\n' }) });
    const h = out.files[0]!.hunks[0]!;
    expect(h.lines[0]!.provenance).toBeNull();
    expect(h.flags.map((f) => f.flag)).toEqual(['untraced']);
    expect(h.flags[0]!.detail).toContain('cat > src/cli.ts');
    expect(h.lead).toMatchObject({ tool: 'shell', editId: 'sh1', turnId: 't1', turnCost: { input: 9, output: 9, cacheRead: 0, cacheWrite: 0 } });
    expect(h.lead?.prompt.text).toBe('write the cli entry point');
    expect(h.lead?.reasoning?.text).toBe('Writing src/cli.ts with a heredoc.');
    expect(out.files[0]!.cost).toEqual({ input: 9, output: 9, cacheRead: 0, cacheWrite: 0 });
  });

  it('reports models it cannot price instead of pricing them at zero', () => {
    const evs: Event[] = [
      { kind: 'prompt', id: 'p', ...base, turnId: 't1', at: 200, text: 'write n.ts' },
      { kind: 'edit', id: 'w1', ...base, turnId: 't1', at: 210, tool: 'Write', file: '/repo/n.ts', op: { type: 'write', content: 'n\n' } },
      { kind: 'usage', id: 'u', ...base, turnId: 't1', at: 220, input: 5, output: 5, cacheRead: 0, cacheWrite: 0, model: 'codex-auto-review' },
    ];
    const out = run({ diffs: [syntheticAdded('n.ts', 'n\n')], sessions: [session(evs)], baseText: () => null, headText: () => 'n\n', repo: repoOf({ 'n.ts': 'n\n' }) });
    expect(out.files[0]!.hunks[0]!.lead?.turnCostUsd).toBeNull();
    expect(out.totals.costUsd).toBe(0);
    expect(out.totals.unpricedModels).toEqual(['codex-auto-review']);
  });

  it('flags a deletion no edit accounts for, and credits one the agent made', () => {
    const del = parseUnifiedDiff('diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n');
    const byHand = run({ diffs: del, baseText: () => 'bye\n', headText: () => null, repo: repoOf({}) });
    expect(byHand.files[0]!.hunks[0]!.flags.map((f) => f.flag)).toEqual(['untraced']);
    const evs: Event[] = [
      { kind: 'prompt', id: 'p', ...base, turnId: 't1', at: 200, text: 'remove gone.ts' },
      { kind: 'edit', id: 'rm1', ...base, turnId: 't1', at: 210, tool: 'apply_patch', file: '/repo/gone.ts', op: { type: 'delete' } },
    ];
    const byAgent = run({ diffs: del, sessions: [session(evs)], baseText: () => 'bye\n', headText: () => null, repo: repoOf({}) });
    const h = byAgent.files[0]!.hunks[0]!;
    expect(h.flags).toEqual([]);
    expect(h.lead?.editId).toBe('rm1');
  });

  it('picks the lead by majority and counts other turns', () => {
    const evs: Event[] = [
      { kind: 'prompt', id: 'p1', ...base, turnId: 't1', at: 200, text: 'write f.ts' },
      { kind: 'edit', id: 'w', ...base, turnId: 't1', at: 210, tool: 'Write', file: '/repo/f.ts', op: { type: 'write', content: 'a\nb\nc\n' } },
      { kind: 'prompt', id: 'p2', ...base, turnId: 't2', at: 300, text: 'tweak f.ts' },
      { kind: 'edit', id: 'e', ...base, turnId: 't2', at: 310, tool: 'Edit', file: '/repo/f.ts', op: { type: 'replace', old: 'b', new: 'B', all: false } },
    ];
    const content = 'a\nB\nc\n';
    const out = run({ diffs: [syntheticAdded('f.ts', content)], sessions: [session(evs)], baseText: () => null, headText: () => content, repo: repoOf({ 'f.ts': content }) });
    const h = out.files[0]!.hunks[0]!;
    expect(h.lead?.editId).toBe('w');
    expect(h.otherTurns).toBe(1);
    expect(out.files[0]!.turnIds).toEqual(['t1', 't2']);
  });

  it('names subagents from spawn events', () => {
    const evs: Event[] = [
      { kind: 'prompt', id: 'p1', ...base, turnId: 't1', at: 200, text: 'make g.ts' },
      { kind: 'spawn', id: 'sp', ...base, turnId: 't1', at: 205, childAgentId: 'abc', name: 'helper', brief: 'write g' },
      { kind: 'edit', id: 'w', sessionId: 's1', agentId: 'abc', turnId: 't1', at: 210, tool: 'Write', file: '/repo/g.ts', op: { type: 'write', content: 'g\n' } },
    ];
    const out = run({ diffs: [syntheticAdded('g.ts', 'g\n')], sessions: [session(evs)], baseText: () => null, headText: () => 'g\n', repo: repoOf({ 'g.ts': 'g\n' }) });
    const h = out.files[0]!.hunks[0]!;
    expect(h.lead?.agentName).toBe('helper');
    expect(h.lead?.agentBrief).toBe('write g');
    expect(h.flags.map((f) => f.flag)).toEqual(['subagent']);
  });
});
