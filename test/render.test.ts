import { describe, it, expect } from 'vitest';
import { renderJson } from '../src/render/json.js';
import { renderTerminal, fmtTokens, verdict } from '../src/render/terminal.js';
import { paint } from '../src/render/ansi.js';
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
  totals: { files: 2, hunks: 3, flagged: { untraced: 1, unrequested: 1, 'after-correction': 1, subagent: 0, churned: 0, drifted: 0 }, cost: { input: 130, output: 28, cacheRead: 1200, cacheWrite: 0 }, costUsd: 0.002, unpricedModels: [] },
};

describe('fmtTokens', () => {
  it('counts fresh work as tokens and reports cache reads separately', () => {
    expect(fmtTokens(null)).toBe('–');
    expect(fmtTokens({ input: 900, output: 50, cacheRead: 0, cacheWrite: 0 })).toBe('950 tokens');
    expect(fmtTokens({ input: 30, output: 8, cacheRead: 1200, cacheWrite: 0 })).toBe('38 tokens · 1.2k from cache');
    expect(fmtTokens({ input: 1_000_000, output: 200_000, cacheRead: 40_900_000, cacheWrite: 0 })).toBe('1.2M tokens · 40.9M from cache');
    expect(fmtTokens({ input: 100, output: 0, cacheRead: 0, cacheWrite: 400 })).toBe('500 tokens'); // cache writes are fresh work
  });
});

describe('verdict', () => {
  it('counts flagged hunks by flag in severity order, omitting zeros', () => {
    expect(verdict(diff)).toBe('3 hunks across 2 files, 2 need a look: 1 untraced, 1 unrequested, 1 after-correction');
    const clean = { ...diff, files: diff.files.map((f) => ({ ...f, hunks: f.hunks.map((h) => ({ ...h, flags: [] })) })) };
    expect(verdict(clean)).toBe('3 hunks across 2 files, nothing flagged');
    expect(verdict({ ...diff, files: [], totals: { ...diff.totals, files: 0, hunks: 0 } })).toBe('no changes');
    const one = { ...diff, files: [diff.files[1]!], totals: { ...diff.totals, files: 1, hunks: 2 } };
    expect(verdict(one)).toBe('2 hunks across 1 file, 1 needs a look: 1 untraced');
  });
});

describe('renderTerminal', () => {
  it('groups flagged hunks by the turn that produced them, worst group first, then an unflagged summary', () => {
    const out = renderTerminal(diff, { color: false, all: false });
    expect(out).toBe([
      '3 hunks across 2 files, 2 need a look: 1 untraced, 1 unrequested, 1 after-correction',
      'estimated cost $0.0020 (claude-opus-5) · built-in prices, --prices to override',
      '',
      'no turn found',
      '  src/a.ts @@ -5,0 +6,2 @@',
      '    ! untraced  no structured edit covers these lines',
      '    file differs from what the recorded edits produce; some lines were changed another way',
      '  +x',
      '  +y',
      '',
      'turn 3 · claude-code · main agent · 2026-10-01 10:00 · 38 tokens · 1.2k from cache · ~$0.0010',
      "  you asked: no, don't touch the readme. put the docs in docs/notes.md instead",
      '  agent said: Moving the notes.',
      '  docs/notes.md @@ -0,0 +1 @@',
      '    ! unrequested  prompt named README.md',
      '    ! after-correction  prompt begins "no, don\'t touch the readme."',
      '  +# notes',
      '',
      'unflagged:',
      '  src/a.ts  1 hunk  1 turn  120 tokens · ~$0.0010',
      '',
    ].join('\n'));
  });

  it('shows no dollar figures when no price table was given', () => {
    const strip = (h: AnnotatedHunk): AnnotatedHunk => ({ ...h, lead: h.lead ? { ...h.lead, turnCostUsd: null } : null, lines: h.lines.map((l) => ({ ...l, provenance: l.provenance ? { ...l.provenance, turnCostUsd: null } : null })) });
    const d = { ...diff, files: diff.files.map((f) => ({ ...f, costUsd: null, hunks: f.hunks.map(strip) })), totals: { ...diff.totals, costUsd: null, unpricedModels: [] } };
    const out = renderTerminal(d, { color: false, all: true });
    expect(out).not.toContain('$');
    expect(out).not.toContain('estimated cost');
  });

  it('names unpriced models instead of hiding them', () => {
    const d = { ...diff, totals: { ...diff.totals, costUsd: 0, unpricedModels: ['codex-auto-review'] } };
    expect(renderTerminal(d, { color: false, all: false })).toContain('\nestimated cost $0.0000 (claude-opus-5) · no price for codex-auto-review · --prices to override\n');
  });

  it('brief mode prints headers and flags only, no diff bodies or reasoning', () => {
    const out = renderTerminal(diff, { color: false, all: false, brief: true });
    expect(out).toBe([
      '3 hunks across 2 files, 2 need a look: 1 untraced, 1 unrequested, 1 after-correction',
      'estimated cost $0.0020 (claude-opus-5) · built-in prices, --prices to override',
      '',
      'no turn found',
      '  src/a.ts @@ -5,0 +6,2 @@  untraced',
      '',
      'turn 3 · claude-code · main agent · 2026-10-01 10:00 · 38 tokens · 1.2k from cache · ~$0.0010',
      "  you asked: no, don't touch the readme. put the docs in docs/notes.md instead",
      '  docs/notes.md @@ -0,0 +1 @@  unrequested, after-correction',
      '',
      'unflagged:',
      '  src/a.ts  1 hunk  1 turn  120 tokens · ~$0.0010',
      '',
    ].join('\n'));
  });

  it('labels hunks with their commit and shows unrecorded prompts honestly', () => {
    const blankLead = { ...prov, prompt: { ...prov.prompt, text: '' }, reasoning: { text: '', at: 0 } };
    const d = { ...diff, files: [{ ...diff.files[0]!, commit: 'abc1234', hunks: [{ ...flagged, lead: blankLead }] }] };
    const out = renderTerminal(d, { color: false, all: false });
    expect(out).toContain('  docs/notes.md (abc1234) @@ -0,0 +1 @@');
    expect(out).toContain('  you asked: (not recorded)\n');
    expect(out).not.toContain('agent said:');
  });

  it('prints a hunk-level "agent said" only when it changes', () => {
    const r = (t: string) => ({ ...prov, reasoning: { text: t, at: 0 } });
    const a: AnnotatedHunk = { ...flagged, lead: r('Step one.') };
    const b: AnnotatedHunk = { ...flagged, newStart: 5, lead: r('Step two.') };
    const b2: AnnotatedHunk = { ...flagged, newStart: 9, lead: r('Step two.') };
    const d = { ...diff, files: [{ ...diff.files[0]!, hunks: [a, b, b2] }] };
    const out = renderTerminal(d, { color: false, all: false });
    expect(out.match(/agent said: Step two\./g)).toHaveLength(1);
    expect(out).toContain('  agent said: Step one.\n'); // the group header carries the first
  });

  it('names the subagent and its brief in the group header', () => {
    const sub: AnnotatedHunk = { ...flagged, lead: { ...prov, agentId: 'abc', agentName: 'helper', agentBrief: 'Write the notes file' }, flags: [{ flag: 'subagent', detail: 'helper' }] };
    const d = { ...diff, files: [{ ...diff.files[0]!, hunks: [sub] }] };
    expect(renderTerminal(d, { color: false, all: false })).toContain('turn 3 · claude-code · subagent helper · 2026-10-01 10:00 · 38 tokens · 1.2k from cache · ~$0.0010\n  brief: Write the notes file\n  you asked: ');
  });

  it('caps long hunks and notes a file that differs from the replayed edits', () => {
    const big: AnnotatedHunk = { ...untraced, lines: Array.from({ length: 100 }, (_, i) => ({ text: `l${i}`, provenance: null })) };
    const d = { ...diff, files: [{ ...diff.files[1]!, hunks: [big] }] };
    const out = renderTerminal(d, { color: false, all: false });
    expect(out).toContain('    file differs from what the recorded edits produce; some lines were changed another way');
    expect(out).toContain('  +l39\n    … 60 more lines\n');
    expect(out).not.toContain('+l40');
  });

  it('labels a lead that came from a shell command rather than a structured edit', () => {
    const viaShell: AnnotatedHunk = { ...untraced, lead: { ...prov, tool: 'shell', editId: 'sh1' } };
    const d = { ...diff, files: [{ ...diff.files[1]!, hunks: [viaShell], ledgerMismatch: false }] };
    const out = renderTerminal(d, { color: false, all: false });
    expect(out).toContain('turn 3 · claude-code · main agent · 2026-10-01 10:00 · 38 tokens · 1.2k from cache · ~$0.0010\n  you asked: ');
    expect(out).not.toContain('no turn found');
  });

  it('prints every hunk with --all and no summary', () => {
    const out = renderTerminal(diff, { color: false, all: true });
    expect(out).toContain('turn 1 · claude-code · main agent · 2026-10-01 10:00 · 120 tokens · ~$0.0010\n');
    expect(out).toContain('  src/a.ts @@ -2 +2 @@\n    file differs from what the recorded edits produce; some lines were changed another way\n  -two\n  +2\n');
    expect(out).not.toContain('unflagged:');
  });

  it('wraps with ANSI only when color is on', () => {
    expect(renderTerminal(diff, { color: true, all: false })).toContain('\u001b[');
    expect(renderTerminal(diff, { color: false, all: false })).not.toContain('\u001b[');
    expect(paint(false).red('x')).toBe('x');
    expect(paint(true).red('x')).toBe('\u001b[31mx\u001b[39m');
  });
});

describe('renderJson', () => {
  it('round-trips the object with a trailing newline', () => {
    const s = renderJson(diff);
    expect(s.endsWith('\n')).toBe(true);
    expect(JSON.parse(s)).toEqual(diff);
  });
});
