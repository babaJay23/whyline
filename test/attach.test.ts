import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { verifyCommits } from '../src/verify.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from './helpers/tmp-repo.js';
import { attachCommits, recordFor } from '../src/attach.js';
import { noteShow, parents } from '../src/git.js';
import { parseRecord } from '../src/record.js';
import { slug } from '../src/adapters/claude-code.js';

function session(home: string, cwd: string, at: number, prompt: string, file: string, old: string, neu: string, id = 'att') {
  const dir = join(home, '.claude', 'projects', slug(cwd));
  mkdirSync(dir, { recursive: true });
  const t = (ms: number) => new Date(at + ms).toISOString();
  const rows = [
    { type: 'user', uuid: 'u1', promptId: 'p1', timestamp: t(0), cwd, sessionId: id, message: { role: 'user', content: prompt }, origin: { kind: 'human' } },
    { type: 'assistant', uuid: 'a1', requestId: 'r1', timestamp: t(10), cwd, sessionId: id, message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: join(cwd, file), old_string: old, new_string: neu, replace_all: false } }], usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ];
  writeFileSync(join(dir, `${id}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
const settle = () => new Promise((r) => setTimeout(r, 1100));

describe('attach', () => {
  it('records a commit against its parent, overwrites on re-attach, skips merges, reports commits without sessions', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    const base = r.commit('base');
    r.git('checkout', '-q', '-b', 'side', base);
    r.write('g.txt', 'g\n');
    const side = r.commit('by hand elsewhere'); // before any session exists
    r.git('checkout', '-q', 'main');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    session(home, r.dir, Date.now() - 500, 'edit f.txt', 'f.txt', 'a', 'b');
    r.write('f.txt', 'b\n');
    await settle();
    const c1 = r.commit('agent change');
    const m = r.merge('side');
    expect(parents(r.dir, m)).toHaveLength(2);

    const opts = { prompts: true, now: Date.now(), home };
    const results = await attachCommits(r.dir, [c1, side, m], opts);
    expect(results.map((x) => x.status)).toEqual(['attached', 'no-sessions', 'skipped-merge']);
    const stored = parseRecord(noteShow(r.dir, c1)!)!;
    expect(stored.commit).toBe(c1);
    expect(stored.prompts).toBe(true);
    expect(stored.record.files[0]!.hunks[0]!.lead?.prompt.text).toBe('edit f.txt');
    expect(stored.record.range).toBe(`${base}..${c1}`);

    const again = await attachCommits(r.dir, [c1], { ...opts, prompts: false });
    expect(again[0]!.status).toBe('attached');
    const replaced = parseRecord(noteShow(r.dir, c1)!)!;
    expect(replaced.prompts).toBe(false);
    expect(replaced.record.files[0]!.hunks[0]!.lead?.prompt.text).toBe('');
    expect(await recordFor(r.dir, side, opts)).toBeNull();
  });

  it('signs records when asked and verify reports the signer', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    session(home, r.dir, Date.now() - 500, 'edit f.txt', 'f.txt', 'a', 'b');
    r.write('f.txt', 'b\n');
    await settle();
    const c1 = r.commit('agent change');
    const keydir = mkdtempSync(join(tmpdir(), 'whyline-key-'));
    const key = join(keydir, 'k');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
    writeFileSync(join(keydir, 'allowed'), `dev@example.com ${readFileSync(key + '.pub', 'utf8')}`);
    r.git('config', 'gpg.format', 'ssh');
    r.git('config', 'user.email', 'dev@example.com');
    r.git('config', 'user.signingkey', key);
    r.git('config', 'gpg.ssh.allowedSignersFile', join(keydir, 'allowed'));
    const [res] = await attachCommits(r.dir, [c1], { prompts: true, now: Date.now(), home, sign: true });
    expect(res!.status).toBe('attached');
    expect(verifyCommits(r.dir, [c1])[0]!.signature).toEqual({ signer: 'dev@example.com' });
    r.git('config', 'user.signingkey', key + '.missing');
    const [bad] = await attachCommits(r.dir, [c1], { prompts: true, now: Date.now(), home, sign: true });
    expect(bad!.status).toBe('sign-failed');
    expect(verifyCommits(r.dir, [c1])[0]!.signature).toEqual({ signer: 'dev@example.com' }); // the earlier good record was not replaced
  });

  it('treats a Spec: trailer in the commit message as satisfying every hunk', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    session(home, r.dir, Date.now() - 500, 'edit f.txt', 'f.txt', 'a', 'b');
    r.write('f.txt', 'b\n');
    await settle();
    const c1 = r.commit('agent change\n\nSpec: docs/design.md');
    const [res] = await attachCommits(r.dir, [c1], { prompts: true, now: Date.now(), home });
    if (res!.status !== 'attached') throw new Error(res!.status);
    expect(res!.record.record.files[0]!.hunks[0]!.flags.map((f) => f.flag)).toEqual([]);
  });

  it('finds a session that ran in the same second as the commit', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    session(home, r.dir, Date.now(), 'edit f.txt', 'f.txt', 'a', 'b'); // no gap before the commit
    r.write('f.txt', 'b\n');
    const c1 = r.commit('agent change');
    const [res] = await attachCommits(r.dir, [c1], { prompts: true, now: Date.now(), home });
    expect(res!.status).toBe('attached');
  });

  it('handles a root commit with no parent', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    session(home, r.dir, Date.now() - 500, 'create f.txt', 'f.txt', '', 'a');
    await settle();
    const root = r.commit('root');
    const [res] = await attachCommits(r.dir, [root], { prompts: true, now: Date.now(), home });
    expect(res!.status).toBe('attached'); // nothing traces (the edit op is empty) but the record exists
  });
});
