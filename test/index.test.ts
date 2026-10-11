import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findSessions } from '../src/sessions.js';
import { indexEvents, relPath, selectEdits, turnKey } from '../src/resolve/index.js';
import type { EditEvent } from '../src/types.js';

const HOME = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'home');

async function index() {
  const { selected } = await findSessions('/repo', HOME, { window: { from: 0, to: Number.MAX_SAFE_INTEGER } });
  return indexEvents(selected, '/repo');
}

describe('relPath', () => {
  it('relativizes paths inside the repo and rejects others', () => {
    expect(relPath('/repo', '/repo/src/a.ts')).toBe('src/a.ts');
    expect(relPath('/repo/', '/repo/src/a.ts')).toBe('src/a.ts');
    expect(relPath('/repo', '/repository/x')).toBeNull();
    expect(relPath('/repo', '/tmp/x')).toBeNull();
  });
});

describe('selectEdits', () => {
  const e = (at: number): EditEvent => ({ kind: 'edit', id: `e${at}`, sessionId: 's', agentId: 's', turnId: 't', at, tool: 'Edit', file: 'f', op: { type: 'delete' } });
  it('keeps edits after the base commit and up to the head, exclusive/inclusive', () => {
    expect(selectEdits([e(5), e(10), e(15), e(20)], { from: 10, to: 20 }).map((x) => x.at)).toEqual([15, 20]);
  });
});

describe('indexEvents', () => {
  it('builds turns with prompt, reasoning, summed usage and interrupt flags', async () => {
    const ix = await index();
    const p1 = ix.turns.get(turnKey('sess-1', 'p1'))!;
    expect(p1.prompt?.text).toMatch(/^add a TRANSCRIPTION/);
    expect(p1.reasoning.map((r) => r.visible)).toEqual([false, true, true]);
    expect(p1.usage).toEqual({ input: 160, output: 39, cacheRead: 1000, cacheWrite: 50 });
    expect(p1.interrupted).toBe(false);
    const p2 = ix.turns.get(turnKey('sess-1', 'p2'))!;
    expect(p2.prompt).toBeNull();
    expect(p2.interrupted).toBe(true);
    const p3 = ix.turns.get(turnKey('sess-1', 'p3'))!;
    expect(p3.prevInterrupted).toBe(true);
    expect([p1.number, p2.number, p3.number]).toEqual([1, 2, 3]);
    expect(p1.prevInterrupted).toBe(false);
    expect(ix.turns.get(turnKey('cx-1', 'ct2'))!.interrupted).toBe(true);
  });

  it('groups edits by repo-relative path across harnesses', async () => {
    const ix = await index();
    expect([...ix.editsByFile.keys()].sort()).toEqual(['docs/notes.md', 'src/a.ts', 'src/b.ts', 'src/new.ts', 'src/util.ts', 'src/x.ts']);
    expect(ix.editsByFile.get('src/util.ts')!.map((e) => e.turnId)).toEqual(['ct1']);
  });

  it('records spawned agents and harness per session', async () => {
    const ix = await index();
    expect(ix.agents.get('abc')).toEqual({ name: 'helper', brief: 'Write b.ts' });
    expect(ix.harnessOf.get('sess-1')).toBe('claude-code');
    expect(ix.harnessOf.get('cx-1')).toBe('codex');
    expect(ix.shells).toHaveLength(3);
  });
});
