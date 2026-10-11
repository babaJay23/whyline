import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { codex } from '../src/adapters/codex.js';
import { adapters } from '../src/adapters/index.js';
import type { Event } from '../src/types.js';

const HOME = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'home');
const by = <K extends Event['kind']>(evs: Event[], k: K) => evs.filter((e): e is Extract<Event, { kind: K }> => e.kind === k);

describe('adapters registry', () => {
  it('lists both harnesses in order', () => {
    expect(adapters.map((a) => a.harness)).toEqual(['claude-code', 'codex']);
  });
});

describe('codex.discover', () => {
  it('finds the rollout for the repo and nothing for another', async () => {
    const refs = await codex.discover('/repo', HOME);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ harness: 'codex', id: 'cx-1', cwd: '/repo', startedAt: Date.parse('2026-10-01T10:00:00.000Z') });
    expect(refs[0]!.endedAt).toBe(Date.parse('2026-10-01T10:00:07.000Z'));
    expect(await codex.discover('/elsewhere', HOME)).toEqual([]);
  });
});

describe('codex.read', () => {
  async function load() {
    const [ref] = await codex.discover('/repo', HOME);
    return (await codex.read(ref!)).events;
  }

  it('emits user_message events as prompts under the current turn and skips injected instructions', async () => {
    expect(by(await load(), 'prompt').map((p) => [p.turnId, p.text])).toEqual([
      ['ct1', 'rename the helper in src/util.ts to formatName'],
      ['ct2', 'stop, that is wrong, keep the old name'],
    ]);
  });

  it('emits reasoning from summaries (hidden) and agent messages (visible)', async () => {
    expect(by(await load(), 'reasoning').map((r) => [r.visible, r.text])).toEqual([
      [false, 'Find the helper and rename it.'],
      [true, 'Renaming the helper now.'],
    ]);
  });

  it('turns apply_patch into edits with the call id as edit id', async () => {
    const edits = by(await load(), 'edit');
    expect(edits.map((e) => [e.id, e.tool, e.file, e.op.type, e.turnId])).toEqual([
      ['call_2', 'apply_patch', '/repo/src/util.ts', 'replace', 'ct1'],
      ['call_2', 'apply_patch', '/repo/src/new.ts', 'write', 'ct1'],
      ['call_5', 'apply_patch', '/repo/src/x.ts', 'replace', 'ct2'],
    ]);
  });

  it('emits shell events for exec_command and shell, skipping unparsable arguments and heredoc patches', async () => {
    const sh = by(await load(), 'shell');
    expect(sh.map((s) => [s.turnId, s.command])).toEqual([
      ['ct1', 'grep -n helper src/util.ts'],
      ['ct2', "bash -lc sed -i '' s/formatName/helper/ src/util.ts"],
    ]);
    expect(sh[1]!.touches).toContain('src/util.ts');
  });

  it('maps token_count to usage with cached tokens split out', async () => {
    expect(by(await load(), 'usage').map((u) => [u.turnId, u.input, u.cacheRead, u.cacheWrite, u.output])).toEqual([
      ['ct1', 1000, 4000, 0, 120],
    ]);
  });

  it('emits an interrupt for turn_aborted with reason interrupted', async () => {
    expect(by(await load(), 'interrupt').map((i) => i.turnId)).toEqual(['ct2']);
  });

  it('uses the session id as agentId everywhere', async () => {
    for (const e of await load()) expect(e.agentId).toBe('cx-1');
  });
});
