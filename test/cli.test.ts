import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from './helpers/tmp-repo.js';
import { run, type Io } from '../src/main.js';
import { slug } from '../src/adapters/claude-code.js';

function io(cwd: string, home: string): Io & { out: string; err: string } {
  const o = {
    cwd, home, env: {}, now: () => Date.now(), out: '', err: '',
    stdout: { write: (s: string) => (o.out += s), isTTY: false },
    stderr: { write: (s: string) => (o.err += s) },
  };
  return o;
}

function claudeSession(home: string, cwd: string, at: number, prompt: string, edits: { file: string; old: string; neu: string }[]): void {
  const dir = join(home, '.claude', 'projects', slug(cwd));
  mkdirSync(dir, { recursive: true });
  const t = (ms: number) => new Date(at + ms).toISOString();
  const rows: unknown[] = [
    { type: 'user', uuid: 'u1', promptId: 'p1', timestamp: t(0), cwd, sessionId: 'e2e', message: { role: 'user', content: prompt }, origin: { kind: 'human' } },
    { type: 'assistant', uuid: 'a1', requestId: 'r1', timestamp: t(10), cwd, sessionId: 'e2e', message: { model: 'test-model', role: 'assistant', content: [{ type: 'text', text: 'Doing it.' }], usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ];
  edits.forEach((e, i) => {
    rows.push({ type: 'assistant', uuid: `a${i + 2}`, requestId: `r${i + 2}`, timestamp: t(20 + i * 10), cwd, sessionId: 'e2e', message: { model: 'test-model', role: 'assistant', content: [{ type: 'tool_use', id: `tu${i}`, name: 'Edit', input: { file_path: join(cwd, e.file), old_string: e.old, new_string: e.neu, replace_all: false } }], usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  });
  writeFileSync(join(dir, 'e2e.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

const settle = () => new Promise((r) => setTimeout(r, 1100)); // commit times have 1s resolution
// Sessions are stamped half a second in the past so every edit is inside the window even on a fast runner.

describe('whyline (e2e)', () => {
  it('exits 2 outside a git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'whyline-nogit-'));
    const o = io(dir, dir);
    expect(await run([], o)).toBe(2);
    expect(o.err).toContain('not a git repository');
  });

  it('exits 3 with the directories it checked when no sessions exist', async () => {
    const r = makeRepo({ 'a.ts': 'one\n' });
    r.commit('init');
    r.write('a.ts', 'two\n');
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    const o = io(r.dir, home);
    expect(await run([], o)).toBe(3);
    expect(o.err).toContain('.claude/projects');
    expect(o.err).toContain('.codex/sessions');
  });

  it('annotates a working-tree diff, including an untracked file, and flags an unrequested change', async () => {
    const r = makeRepo({ 'src/a.ts': 'one\ntwo\n', 'src/z.ts': 'z\n' });
    r.commit('init');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'change two to 2 in src/a.ts', [
      { file: 'src/a.ts', old: 'two', neu: '2' },
      { file: 'src/z.ts', old: 'z', neu: 'zz' },
    ]);
    r.write('src/a.ts', 'one\n2\n');
    r.write('src/z.ts', 'zz\n');
    r.write('new.txt', 'by hand\n');

    const o = io(r.dir, home);
    expect(await run([], o)).toBe(0);
    expect(o.out).toMatch(/^3 hunks across 3 files, 3 need a look: 1 untraced, 1 unrequested, 2 unspecified\n/);
    expect(o.out).toContain('  src/z.ts @@ -1 +1 @@\n    ! unrequested  prompt named src/a.ts');
    expect(o.out).toContain('  new.txt @@ -0,0 +1 @@\n    ! untraced');
    expect(o.out).not.toContain('unflagged:'); // the requested hunk still had no spec behind it

    const j = io(r.dir, home);
    expect(await run(['--json'], j)).toBe(0);
    const parsed = JSON.parse(j.out);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.files.map((f: { path: string }) => f.path).sort()).toEqual(['new.txt', 'src/a.ts', 'src/z.ts']);

    const h = io(r.dir, home);
    const report = join(home, 'report.html');
    expect(await run(['--html', report], h)).toBe(0);
    expect(existsSync(report)).toBe(true);
    expect(readFileSync(report, 'utf8')).toContain('1 unrequested');
    expect(h.out).toContain(`wrote ${report}`);
  });

  it('annotates a commit range and respects --session', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    const base = r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt per #10', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    r.write('f.txt', 'b\n');
    await settle();
    const head = r.commit('agent change');

    const o = io(r.dir, home);
    expect(await run([`${base}..${head}`, '--all'], o)).toBe(0);
    expect(o.out).toContain('1 hunk across 1 file, nothing flagged');
    expect(o.out).toContain('you asked: edit f.txt per #10');

    const miss = io(r.dir, home);
    expect(await run([`${base}..${head}`, '--session', 'nope'], miss)).toBe(3);
    expect(miss.err).toContain('e2e'); // lists the sessions it did find
  });

  it('measures a two-ref range from the merge base, so edits on a branch are not lost when main moves on', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    r.git('checkout', '-q', '-b', 'work');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt per #10', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    r.write('f.txt', 'b\n');
    await settle();
    r.commit('agent change on work');
    r.git('checkout', '-q', 'main');
    await settle();
    r.write('other.txt', 'teammate\n');
    r.commit('main moved on');
    r.git('checkout', '-q', 'work');

    const o = io(r.dir, home);
    expect(await run(['main...work', '--all'], o)).toBe(0);
    expect(o.out).toContain('1 hunk across 1 file, nothing flagged');
    expect(o.out).toContain('you asked: edit f.txt per #10');
  });

  it('skips untracked binary files', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'hello', []);
    writeFileSync(join(r.dir, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0xff, 0xfe]));
    r.write('notes.txt', 'text\n');
    const o = io(r.dir, home);
    expect(await run(['--json'], o)).toBe(0);
    expect(JSON.parse(o.out).files.map((f: { path: string }) => f.path)).toEqual(['notes.txt']);
  });

  it('reports an unwritable --html path in one line and writes both outputs when --json is also given', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt per #10', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    r.write('f.txt', 'b\n');
    const bad = io(r.dir, home);
    expect(await run(['--html', home], bad)).toBe(1); // a directory, not a file
    expect(bad.err).toMatch(/^whyline: cannot write .*\n$/);
    expect(bad.err).not.toContain('    at ');
    const both = io(r.dir, home);
    const report = join(home, 'both.html');
    expect(await run(['--json', '--html', report], both)).toBe(0);
    expect(JSON.parse(both.out).schemaVersion).toBe(1);
    expect(existsSync(report)).toBe(true);
  });

  it('explains a repository with no commits', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    const o = io(r.dir, r.dir);
    expect(await run([], o)).toBe(1);
    expect(o.err).toBe('whyline: this repository has no commits yet\n');
  });

  it('prices turns from a user table with --prices and prints a brief view with --brief', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt per #10', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    r.write('f.txt', 'b\n');
    const prices = join(home, 'prices.json');
    writeFileSync(prices, JSON.stringify({ 'test-model': { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 } }));
    const plain = io(r.dir, home);
    expect(await run(['--all'], plain)).toBe(0);
    expect(plain.out).not.toContain('$'); // subscriptions are not billed per token; dollars are opt-in
    const o = io(r.dir, home);
    expect(await run(['--all', '--brief', '--prices', prices], o)).toBe(0);
    expect(o.out).toContain('estimated cost $66.0000 (test-model)'); // 66 tokens at $1 each
    expect(o.out).toContain('  f.txt @@ -1 +1 @@\n');
    expect(o.out).not.toContain('+b');
    const builtIn = io(r.dir, home);
    expect(await run(['--prices', 'default'], builtIn)).toBe(0);
    expect(builtIn.out).toContain('no price for test-model');
    const bad = io(r.dir, home);
    expect(await run(['--prices', join(home, 'nope.json')], bad)).toBe(1);
    expect(bad.err).toMatch(/^whyline: cannot read prices /);
  });

  it('attach writes a note for HEAD and reports a range', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt per #10', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    r.write('f.txt', 'b\n');
    await settle();
    const head = r.commit('agent change');
    const o = io(r.dir, home);
    expect(await run(['attach'], o)).toBe(0);
    expect(o.out).toBe(`${head.slice(0, 7)}  attached (1 hunk, 0 flagged)\n`);
    expect(r.git('notes', '--ref', 'whyline', 'list')).toContain(head);
    const none = io(r.dir, mkdtempSync(join(tmpdir(), 'whyline-empty-')));
    expect(await run(['attach', '--quiet'], none)).toBe(3);
    expect(none.out).toBe('');
    expect(none.err).toBe(''); // a commit with no agent session is routine for a hook, not an error
    expect(existsSync(join(r.dir, '.git', 'whyline-last-error'))).toBe(false);
  });

  it('renders from attached records when transcripts are gone, and refuses a partial set', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    const base = r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt per #10', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    r.write('f.txt', 'b\n');
    await settle();
    const c1 = r.commit('agent change');
    expect(await run(['attach', '--no-prompts'], io(r.dir, home))).toBe(0);
    r.write('f.txt', 'c\n');
    await settle();
    const c2 = r.commit('by hand');

    const gone = mkdtempSync(join(tmpdir(), 'whyline-gone-')); // a machine with no transcripts
    const one = io(r.dir, gone);
    expect(await run([`${base}..${c1}`, '--all'], one)).toBe(0);
    expect(one.out).toContain('from attached records (1 commit)');
    expect(one.out).toContain(`  f.txt (${c1.slice(0, 7)}) @@ -1 +1 @@`);
    expect(one.out).toContain('you asked: (not recorded)');

    const partial = io(r.dir, gone);
    expect(await run([`${base}..${c2}`], partial)).toBe(3);
    expect(partial.err).toContain(`missing record for ${c2.slice(0, 7)}`);

    const forbidden = io(r.dir, gone);
    expect(await run([`${base}..${c1}`, '--no-notes'], forbidden)).toBe(3);
    expect(forbidden.err).toContain('no agent sessions');

    const forced = io(r.dir, home); // transcripts exist, but ask for notes anyway
    expect(await run([`${base}..${c1}`, '--from-notes', '--all'], forced)).toBe(0);
    expect(forced.out).toContain('from attached records');
  });

  it('exports Agent Trace records as JSON lines, from notes or transcripts', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    const base = r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt per #10', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    r.write('f.txt', 'b\n');
    await settle();
    const c1 = r.commit('agent change');
    const o = io(r.dir, home);
    expect(await run(['export', `${base}..${c1}`, '--format', 'agent-trace'], o)).toBe(0);
    const lines = o.out.trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.vcs.revision).toBe(c1);
    expect(rec.files[0].path).toBe('f.txt');
    expect(rec.files[0].conversations[0].ranges).toEqual([{ start_line: 1, end_line: 1 }]);
    const bad = io(r.dir, home);
    expect(await run(['export', '--format', 'csv'], bad)).toBe(1);
  });

  it('verify reports each commit and fails on a missing record', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    const base = r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt per #10', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    r.write('f.txt', 'b\n');
    await settle();
    const c1 = r.commit('agent change');
    r.write('f.txt', 'c\n');
    const c2 = r.commit('by hand');
    expect(await run(['attach', c1], io(r.dir, home))).toBe(0);
    const o = io(r.dir, home);
    expect(await run(['verify', `${base}..${c2}`], o)).toBe(3);
    expect(o.out).toBe(`${c1.slice(0, 7)}  attached  hash ok  unsigned\n${c2.slice(0, 7)}  missing\n`);
    const ok = io(r.dir, home);
    expect(await run(['verify', c1], ok)).toBe(0);
  });

  it('install, doctor, uninstall', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    const o = io(r.dir, home);
    expect(await run(['install'], o)).toBe(0);
    expect(o.out).toContain('installed post-commit hook');
    const d = io(r.dir, home);
    expect(await run(['doctor'], d)).toBe(0);
    expect(d.out).toContain('hook: installed (whyline attach HEAD --quiet || true)');
    expect(d.out).toContain('signing: not configured');
    const u = io(r.dir, home);
    expect(await run(['uninstall'], u)).toBe(0);
    expect(u.out).toContain('removed');
    const d2 = io(r.dir, home);
    await run(['doctor'], d2);
    expect(d2.out).toContain('hook: not installed');
  });

  it('prints markdown with --format md', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt per #42', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    r.write('f.txt', 'b\n');
    const o = io(r.dir, home);
    expect(await run(['--format', 'md', '--all'], o)).toBe(0);
    expect(o.out).toMatch(/^\*\*1 hunk across 1 file, nothing flagged\*\*\n/);
    expect(o.out).toContain('- `f.txt` @@ -1 +1 @@\n');
    const bad = io(r.dir, home);
    expect(await run(['--format', 'xml'], bad)).toBe(1);
  });

  it('check fails with exit 4 on a forbidden flag and prints markdown', async () => {
    const r = makeRepo({ 'src/a.ts': 'one\ntwo\n', 'src/z.ts': 'z\n' });
    r.commit('init');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'change two to 2 in src/a.ts per #77', [{ file: 'src/a.ts', old: 'two', neu: '2' }, { file: 'src/z.ts', old: 'z', neu: 'zz' }]);
    r.write('src/a.ts', 'one\n2\n');
    r.write('src/z.ts', 'zz\n');
    const policy = join(home, 'policy.json');
    writeFileSync(policy, JSON.stringify({ forbid: ['unrequested'] }));
    const o = io(r.dir, home);
    expect(await run(['check', '--policy', policy], o)).toBe(4);
    expect(o.out).toMatch(/^policy: FAIL\n  forbid: 1 unrequested hunk\n/);
    const md = io(r.dir, home);
    expect(await run(['check', '--policy', policy, '--format', 'md'], md)).toBe(4);
    expect(md.out).toContain('| forbid | 1 unrequested hunk |');
    const report = io(r.dir, home);
    expect(await run(['check'], report)).toBe(0);
    expect(report.out).toMatch(/^policy: PASS \(no policy given\)\n/);
    const missing = io(r.dir, home);
    expect(await run(['check', '--policy', join(home, 'nope.json')], missing)).toBe(1);
  });

  it('install warns when whyline is not on PATH, and doctor repeats it', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    const o = io(r.dir, home); // env is {} so PATH is empty
    expect(await run(['install'], o)).toBe(0);
    expect(o.err).toContain('whyline is not on PATH');
    const d = io(r.dir, home);
    await run(['doctor'], d);
    expect(d.out).toContain('hook: installed');
    expect(d.out).toContain('whyline is not on PATH');
  });

  it('a hand commit is not a failure, a sign failure is, and a later success clears it', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    r.write('f.txt', 'b\n');
    r.commit('by hand');
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    const errFile = join(r.dir, '.git', 'whyline-last-error');
    expect(await run(['attach', '--quiet'], io(r.dir, home))).toBe(3);
    expect(existsSync(errFile)).toBe(false); // no agent session is routine for a hook
    await settle();
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt per #10', [{ file: 'f.txt', old: 'b', neu: 'c' }]);
    r.write('f.txt', 'c\n');
    await settle();
    r.commit('agent change');
    expect(await run(['attach', '--quiet', '--sign'], io(r.dir, home))).toBe(3); // no signing key configured
    expect(readFileSync(errFile, 'utf8')).toContain('not signed');
    expect(await run(['attach', '--quiet'], io(r.dir, home))).toBe(0);
    expect(existsSync(errFile)).toBe(false);
  });

  it('attach --since widens the window; merges are reported, not hidden; --from-notes refuses partial notes', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    const sessionAt = Date.now();
    claudeSession(home, r.dir, sessionAt, 'edit f.txt per #10', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    await settle();
    const base = r.commit('base'); // the session predates this commit, as after a rebase
    r.write('f.txt', 'b\n');
    await settle();
    const c1 = r.commit('replayed agent change');
    expect(await run(['attach', c1], io(r.dir, home))).toBe(3);
    const widened = io(r.dir, home);
    expect(await run(['attach', c1, '--since', new Date(sessionAt - 1000).toISOString()], widened)).toBe(0);
    expect(widened.out).toContain('attached');

    r.git('checkout', '-q', '-b', 'side', base);
    r.write('g.txt', 'g\n');
    r.commit('side');
    r.git('checkout', '-q', 'main');
    const m = r.merge('side');
    const v = io(r.dir, home);
    await run(['verify', `${base}..${m}`], v);
    expect(v.out).toContain(`${m.slice(0, 7)}  merge (not recorded)`);
    const gone = mkdtempSync(join(tmpdir(), 'whyline-gone-'));
    const notes = io(r.dir, gone);
    await run([`${base}..${m}`, '--all'], notes);
    expect(notes.err).toContain('merge commit');

    r.write('f.txt', 'd\n');
    const c3 = r.commit('by hand, no record');
    const partial = io(r.dir, home); // transcripts exist, notes are partial, user insisted on notes
    expect(await run([`${base}..${c3}`, '--from-notes'], partial)).toBe(3);
    expect(partial.err).toContain(`missing record for ${c3.slice(0, 7)}`);
  });

  it('a live range review honours a Spec: trailer in the commit message', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    const base = r.commit('base');
    await settle();
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'edit f.txt', [{ file: 'f.txt', old: 'a', neu: 'b' }]);
    r.write('f.txt', 'b\n');
    await settle();
    const c1 = r.commit('agent change\n\nSpec: docs/design.md');
    const o = io(r.dir, home);
    expect(await run([`${base}..${c1}`], o)).toBe(0);
    expect(o.out).toContain('nothing flagged');
  });

  it('lists sessions and runs doctor', async () => {
    const r = makeRepo({ 'f.txt': 'a\n' });
    r.commit('base');
    const home = mkdtempSync(join(tmpdir(), 'whyline-home-'));
    claudeSession(home, r.dir, Date.now() - 500, 'hello', []);
    const s = io(r.dir, home);
    expect(await run(['sessions'], s)).toBe(0);
    expect(s.out).toContain('claude-code');
    expect(s.out).toContain('e2e');
    const d = io(r.dir, home);
    expect(await run(['doctor'], d)).toBe(0);
    expect(d.out).toContain('claude-code: 1 session');
    expect(d.out).toContain('codex: 0 sessions');
    expect(d.out).toContain('shell');
  });

  it('prints usage and exits 1 on an unknown option', async () => {
    const r = makeRepo({});
    const o = io(r.dir, r.dir);
    expect(await run(['--bogus'], o)).toBe(1);
    expect(o.err).toContain('whyline [range] [options]');
    const h = io(r.dir, r.dir);
    expect(await run(['--help'], h)).toBe(0);
    expect(h.out).toContain('--html <file>');
  });
});
