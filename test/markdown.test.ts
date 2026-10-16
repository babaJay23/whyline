import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/render/markdown.js';
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

describe('renderMarkdown', () => {
  it('prints verdict, groups, and one bullet per flagged hunk with no diff bodies', () => {
    const md = renderMarkdown(diff, { all: false });
    expect(md.startsWith('**3 hunks across 2 files, 2 need a look: 1 untraced, 1 unrequested, 1 after-correction**\n')).toBe(true);
    expect(md).toContain('### no turn found\n- `src/a.ts` @@ -5,0 +6,2 @@ — **untraced**: no structured edit covers these lines\n');
    expect(md).toContain('### turn 3 · claude-code · main agent · 2026-10-01 10:00 · 38 tokens · 1.2k from cache · ~$0.0010\n**you asked:** no, don\'t touch the readme. put the docs in docs/notes.md instead\n<details><summary>agent said</summary>\n\nMoving the notes.\n</details>\n\n- `docs/notes.md` @@ -0,0 +1 @@ — **unrequested**: prompt named README.md; **after-correction**: prompt begins "no, don\'t touch the readme."\n');
    expect(md).not.toContain('+# notes');
    expect(md).not.toContain('-two');
  });

  it('lists unflagged hunks only with all, and renders violations as a table', () => {
    expect(renderMarkdown(diff, { all: false })).not.toContain('@@ -2 +2 @@');
    expect(renderMarkdown(diff, { all: true })).toContain('- `src/a.ts` @@ -2 +2 @@\n');
    const md = renderMarkdown(diff, { all: false, violations: [{ rule: 'forbid', detail: '1 unrequested hunk' }] });
    expect(md).toContain('\n| rule | detail |\n|---|---|\n| forbid | 1 unrequested hunk |\n');
  });

  it('escapes pipes in table cells and shows the banner', () => {
    const md = renderMarkdown(diff, { all: false, banner: 'from attached records (2 commits)', violations: [{ rule: 'x', detail: 'a | b' }] });
    expect(md).toContain('from attached records (2 commits)\n');
    expect(md).toContain('| x | a \\| b |');
  });
});
