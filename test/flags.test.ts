import { describe, it, expect } from 'vitest';
import { flagHunk, namedFiles, CORRECTION_WORDS, type HunkFacts, type RepoFiles } from '../src/resolve/flags.js';
import type { Turn } from '../src/resolve/index.js';
import type { AnnotatedLine, EditEvent, Provenance } from '../src/types.js';

const files: Record<string, string> = {
  'src/a.ts': "import { b } from './b';\nexport const a = b;\n",
  'src/b.ts': 'export const b = 1;\n',
  'src/c.ts': 'export const c = 1;\n',
  'README.md': '# x\n',
};
const repo: RepoFiles = {
  has: (p) => p in files,
  byBasename: (n) => Object.keys(files).filter((p) => p.split('/').pop() === n),
  read: (p) => files[p] ?? null,
};

function prov(over: Partial<Provenance> = {}): Provenance {
  return {
    harness: 'claude-code', sessionId: 's1', turnId: 't1', turnNumber: 1, agentId: 's1', agentName: null, agentBrief: null,
    prompt: { text: 'change src/a.ts', at: 100 }, reasoning: null, tool: 'Edit', editId: 'e1', at: 100, turnCost: null, ...over,
  };
}
function turn(over: Partial<Turn> = {}): Turn {
  return { id: 't1', sessionId: 's1', harness: 'claude-code', prompt: { kind: 'prompt', id: 'p', sessionId: 's1', agentId: 's1', turnId: 't1', at: 100, text: 'change src/a.ts' }, reasoning: [], usage: null, interrupted: false, prevInterrupted: false, firstAt: 100, ...over };
}
function edit(turnId: string, text: string, at: number): EditEvent {
  return { kind: 'edit', id: `e-${at}`, sessionId: 's1', agentId: 's1', turnId, at, tool: 'Edit', file: '/repo/src/a.ts', op: { type: 'replace', old: 'x', new: text, all: false } };
}
function facts(over: Partial<HunkFacts> = {}): HunkFacts {
  const p = prov();
  const lines: AnnotatedLine[] = [{ text: 'export const a = b;', provenance: p }];
  return { file: 'src/a.ts', lines, lead: p, turn: turn(), table: { lines: [], driftedAt: null, failed: [] }, fileEdits: [], shells: [], repo, ...over };
}
const flags = (f: HunkFacts) => flagHunk(f).map((h) => h.flag);

describe('namedFiles', () => {
  it('finds repo paths and basenames mentioned in a prompt', () => {
    expect(namedFiles('fix src/a.ts and also b.ts please', repo)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(namedFiles('fix the failing tests', repo)).toEqual([]);
    expect(namedFiles('see docs/missing.md', repo)).toEqual([]);
  });
});

describe('CORRECTION_WORDS', () => {
  it('matches whole words only', () => {
    expect(CORRECTION_WORDS.test("no, don't do that")).toBe(true);
    expect(CORRECTION_WORDS.test('revert the readme change')).toBe(true);
    expect(CORRECTION_WORDS.test('use jq instead')).toBe(true);
    expect(CORRECTION_WORDS.test('add nothing fancy')).toBe(false); // "no" inside "nothing"
    expect(CORRECTION_WORDS.test('update the Snow module')).toBe(false);
    expect(CORRECTION_WORDS.test('add no-cache headers to the fetch')).toBe(false); // "no" only counts as a sentence opener
    expect(CORRECTION_WORDS.test("there's no README yet, add one")).toBe(false);
    expect(CORRECTION_WORDS.test('No. Put it in utils.')).toBe(true);
    expect(CORRECTION_WORDS.test('stop')).toBe(true);
    expect(CORRECTION_WORDS.test('please undo that')).toBe(false);
    expect(CORRECTION_WORDS.test('undo that')).toBe(true);
  });
});

describe('flagHunk', () => {
  it('returns no flags for a clean, requested hunk', () => {
    expect(flags(facts())).toEqual([]);
  });

  it('untraced when any line has no provenance, with a shell hint when one mentions the file', () => {
    const f = facts({
      lines: [{ text: 'a', provenance: prov() }, { text: 'b', provenance: null }],
      shells: [{ kind: 'shell', id: 'sh', sessionId: 's1', agentId: 's1', turnId: 't9', at: 50, command: "sed -i '' s/x/y/ src/a.ts", touches: ['src/a.ts'] }],
    });
    const hits = flagHunk(f);
    expect(hits[0]!.flag).toBe('untraced');
    expect(hits[0]!.detail).toContain('s/x/y/ src/a.ts');
    const later = { ...f.shells[0]!, id: 'sh2', turnId: 't12', at: 90, command: 'python3 fix.py > src/a.ts' };
    expect(flagHunk({ ...f, shells: [f.shells[0]!, later] })[0]!.detail).toContain('fix.py'); // the most recent write is the likely culprit
    const readOnly = { ...later, id: 'sh3', at: 95, command: 'git show HEAD -- src/a.ts' };
    expect(flagHunk({ ...f, shells: [f.shells[0]!, later, readOnly] })[0]!.detail).toContain('fix.py'); // reads are not culprits
    expect(flagHunk({ ...f, shells: [readOnly] })[0]!.detail).toBe('no structured edit covers these lines');
    expect(flagHunk(facts({ lines: [{ text: 'b', provenance: null }] }))[0]!.detail).toBe('no structured edit covers these lines');
  });

  it('unrequested when the prompt named other files that do not import this one', () => {
    expect(flags(facts({ file: 'src/c.ts', turn: turn({ prompt: { ...turn().prompt!, text: 'edit src/a.ts' } }) }))).toEqual(['unrequested']);
  });

  it('not unrequested when this file is named, imported by a named file, or the prompt names no file', () => {
    expect(flags(facts({ file: 'src/a.ts' }))).toEqual([]);
    expect(flags(facts({ file: 'src/b.ts' }))).toEqual([]); // a.ts imports ./b
    expect(flags(facts({ file: 'src/c.ts', turn: turn({ prompt: { ...turn().prompt!, text: 'fix the failing tests' } }) }))).toEqual([]);
    expect(flags(facts({ file: 'src/c.ts', turn: null, lead: null, lines: [{ text: 'x', provenance: null }] }))).toEqual(['untraced']);
  });

  it('after-correction on correction words in the first 80 chars or a previously interrupted turn', () => {
    const corrected = turn({ prompt: { ...turn().prompt!, text: "no, don't touch src/a.ts like that" } });
    expect(flags(facts({ turn: corrected }))).toEqual(['after-correction']);
    expect(flags(facts({ turn: turn({ prevInterrupted: true }) }))).toEqual(['after-correction']);
    const late = turn({ prompt: { ...turn().prompt!, text: 'please update src/a.ts with the new enum member, run the whole suite and make sure the tests pass; no need to touch docs' } });
    expect(flags(facts({ turn: late }))).toEqual([]); // "no" is past the 80-char window
  });

  it('drifted when the file ledger failed before this hunk', () => {
    expect(flags(facts({ table: { lines: [], driftedAt: 50, failed: ['e0'] } }))).toEqual(['drifted']);
    expect(flags(facts({ table: { lines: [], driftedAt: 500, failed: ['e9'] } }))).toEqual([]); // failure happened after the lead edit
  });

  it('churned when the hunk text appears in edits from three or more turns', () => {
    const text = 'export const a = b;';
    const three = [edit('t1', text, 10), edit('t2', text, 20), edit('t3', text, 30)];
    expect(flags(facts({ fileEdits: three }))).toEqual(['churned']);
    expect(flags(facts({ fileEdits: three.slice(0, 2) }))).toEqual([]);
    expect(flags(facts({ lines: [{ text: 'x', provenance: prov() }], fileEdits: three }))).toEqual([]); // too short to count
    const context = (turnId: string, at: number): EditEvent => ({ ...edit(turnId, 'y', at), op: { type: 'replace', old: `${text}\nold${at}`, new: `${text}\nnew${at}`, all: false } });
    expect(flags(facts({ fileEdits: [context('t1', 10), context('t2', 20), context('t3', 30)] }))).toEqual([]); // the line was context, not rewritten
  });

  it('subagent when the lead agent is not the session main agent', () => {
    const hits = flagHunk(facts({ lead: prov({ agentId: 'abc', agentName: 'helper', agentBrief: 'write g' }) }));
    expect(hits.map((h) => h.flag)).toEqual(['subagent']);
    expect(hits[0]!.detail).toBe('helper');
  });

  it('orders multiple flags by severity', () => {
    const f = facts({
      lines: [{ text: 'export const a = b;', provenance: prov({ agentId: 'abc' }) }, { text: 'zz', provenance: null }],
      lead: prov({ agentId: 'abc' }),
      turn: turn({ prevInterrupted: true }),
    });
    expect(flags(f)).toEqual(['untraced', 'after-correction', 'subagent']);
  });
});
