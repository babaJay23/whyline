import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJsonl } from '../src/adapters/jsonl.js';
import { claudeCode, slug } from '../src/adapters/claude-code.js';
import type { EditEvent, Event } from '../src/types.js';

const HOME = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'home');
const T = (s: string) => Date.parse(s);

describe('readJsonl', () => {
  it('skips blank and unparsable lines and counts them', () => {
    const { rows, skipped } = readJsonl(join(HOME, '.claude/projects/-repo/sess-1.jsonl'));
    expect(skipped).toBe(1); // "not json"; blank lines are not counted
    expect(rows.length).toBe(16);
  });
});

describe('slug', () => {
  it('replaces path separators with dashes', () => {
    expect(slug('/Users/me/Documents/repo')).toBe('-Users-me-Documents-repo');
  });
});

describe('claudeCode.discover', () => {
  it('finds sessions whose cwd is the repo root', async () => {
    const refs = await claudeCode.discover('/repo', HOME);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ harness: 'claude-code', id: 'sess-1', cwd: '/repo' });
    expect(refs[0]!.startedAt).toBe(T('2026-10-01T10:00:01.000Z'));
    expect(refs[0]!.endedAt).toBe(T('2026-10-01T10:00:10.200Z'));
  });

  it('finds nothing for another repo', async () => {
    expect(await claudeCode.discover('/elsewhere', HOME)).toEqual([]);
  });
});

describe('claudeCode.read', () => {
  async function load(): Promise<Event[]> {
    const [ref] = await claudeCode.discover('/repo', HOME);
    const { events, skipped } = await claudeCode.read(ref!);
    expect(skipped).toBe(1);
    return events;
  }
  const by = <K extends Event['kind']>(evs: Event[], k: K) => evs.filter((e): e is Extract<Event, { kind: K }> => e.kind === k);

  it('emits human prompts with promptId as turnId and skips meta and tool results', async () => {
    const prompts = by(await load(), 'prompt');
    expect(prompts.map((p) => [p.turnId, p.text.slice(0, 20)])).toEqual([
      ['p1', 'add a TRANSCRIPTION '],
      ['p3', "no, don't touch the "],
    ]);
  });

  it('emits an interrupt for the interrupted turn', async () => {
    const ints = by(await load(), 'interrupt');
    expect(ints.map((i) => i.turnId)).toEqual(['p2']);
  });

  it('emits reasoning for thinking (hidden) and text (visible)', async () => {
    const r = by(await load(), 'reasoning');
    expect(r.map((x) => [x.visible, x.text.slice(0, 12), x.agentId])).toEqual([
      [false, 'The enum liv', 'sess-1'],
      [true, 'Adding TRANS', 'sess-1'],
      [true, 'Writing b.ts', 'abc'],
    ]);
  });

  it('emits edits for Edit and Write with absolute paths, skipping a tool_use with no input', async () => {
    const edits = by(await load(), 'edit');
    expect(edits.map((e) => [e.tool, e.file, e.turnId, e.agentId])).toEqual([
      ['Edit', '/repo/src/a.ts', 'p1', 'sess-1'],
      ['Write', '/repo/src/b.ts', 'p1', 'abc'],
      ['Write', '/repo/docs/notes.md', 'p3', 'sess-1'],
    ]);
    const first = edits[0] as EditEvent;
    expect(first.op).toEqual({ type: 'replace', old: "  TEXT_TO_SPEECH = 'tts',", new: "  TEXT_TO_SPEECH = 'tts',\n  TRANSCRIPTION = 'stt',", all: false });
    expect(first.id).toBe('toolu_1');
  });

  it('emits shell events with path-looking tokens', async () => {
    const sh = by(await load(), 'shell');
    expect(sh).toHaveLength(1);
    expect(sh[0]!.touches).toEqual(['/repo/README.md']);
  });

  it('deduplicates usage by requestId and attributes it to the turn', async () => {
    const u = by(await load(), 'usage');
    expect(u.map((x) => [x.turnId, x.input, x.output, x.cacheRead, x.cacheWrite])).toEqual([
      ['p1', 100, 20, 1000, 50],
      ['p1', 10, 5, 0, 0],
      ['p1', 10, 5, 0, 0],
      ['p1', 40, 9, 0, 0],
      ['p3', 30, 8, 0, 0],
    ]);
  });

  it('emits a spawn linking the Agent call to the subagent id', async () => {
    const sp = by(await load(), 'spawn');
    expect(sp).toEqual([expect.objectContaining({ turnId: 'p1', childAgentId: 'abc', name: 'helper', brief: 'Write b.ts' })]);
  });

  it('orders all events by time', async () => {
    const evs = await load();
    for (let i = 1; i < evs.length; i++) expect(evs[i]!.at).toBeGreaterThanOrEqual(evs[i - 1]!.at);
  });
});
