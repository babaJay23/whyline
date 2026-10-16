import { describe, it, expect } from 'vitest';
import { makeRepo } from './helpers/tmp-repo.js';
import { repoRoot, commitTime, show, diffText, untracked, readWorkingFile, parseRange, mergeBase, revList, parents, commitMessage, noteShow, noteAdd, noteList, hooksDir, configGet } from '../src/git.js';

describe('git', () => {
  it('finds the repo root from a subdirectory', () => {
    const r = makeRepo({ 'a/b.txt': 'x\n' });
    r.commit('init');
    expect(repoRoot(`${r.dir}/a`)).toBe(r.git('rev-parse', '--show-toplevel'));
    expect(repoRoot('/')).toBeNull();
  });

  it('reads commit time in ms', () => {
    const r = makeRepo({ 'f': '1\n' });
    const sha = r.commit('one');
    const t = commitTime(r.dir, sha);
    expect(t).toBeGreaterThan(Date.now() - 60_000);
    expect(t).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('shows a file at a rev and null when absent', () => {
    const r = makeRepo({ 'f': 'one\n' });
    r.commit('a');
    expect(show(r.dir, 'HEAD', 'f')).toBe('one\n');
    expect(show(r.dir, 'HEAD', 'missing')).toBeNull();
  });

  it('produces a unified=0 diff for working tree and for a range', () => {
    const r = makeRepo({ 'f': 'one\ntwo\n' });
    const a = r.commit('a');
    r.write('f', 'one\n2\n');
    expect(diffText(r.dir, null)).toContain('@@ -2 +2 @@');
    const b = r.commit('b');
    expect(diffText(r.dir, `${a}..${b}`)).toContain('-two');
    expect(diffText(r.dir, `${a}..${b}`)).not.toContain('\n one'); // no context lines (the @@ heading may still name one)
  });

  it('lists untracked files and reads working files', () => {
    const r = makeRepo({ 'f': 'x\n' });
    r.commit('a');
    r.write('new.ts', 'hello\n');
    expect(untracked(r.dir)).toEqual(['new.ts']);
    expect(readWorkingFile(r.dir, 'new.ts')).toBe('hello\n');
    expect(readWorkingFile(r.dir, 'nope')).toBeNull();
  });

  it('parses ranges, including the three-dot form', () => {
    expect(parseRange(null)).toEqual({ base: 'HEAD', head: null });
    expect(parseRange('main..HEAD')).toEqual({ base: 'main', head: 'HEAD' });
    expect(parseRange('main...HEAD')).toEqual({ base: 'main', head: 'HEAD' });
    expect(parseRange('abc123')).toEqual({ base: 'abc123', head: null });
  });

  it('finds the merge base of two refs', () => {
    const r = makeRepo({ 'f': '1\n' });
    const a = r.commit('a');
    r.git('checkout', '-q', '-b', 'work');
    r.write('f', '2\n');
    r.commit('b');
    r.git('checkout', '-q', 'main');
    r.write('f', '3\n');
    r.commit('c');
    expect(mergeBase(r.dir, 'main', 'work')).toBe(a);
    expect(mergeBase(r.dir, 'main', 'nope')).toBeNull();
  });
});

describe('git commits and notes', () => {
  it('lists a range oldest first and a bare rev as itself', () => {
    const r = makeRepo({ f: '1\n' });
    const a = r.commit('a');
    r.write('f', '2\n'); const b = r.commit('b');
    r.write('f', '3\n'); const c = r.commit('c');
    expect(revList(r.dir, `${a}..${c}`)).toEqual([b, c]);
    expect(revList(r.dir, c)).toEqual([c]);
    expect(revList(r.dir, 'nope')).toEqual([]);
  });

  it('reports parents so merges can be recognised', () => {
    const r = makeRepo({ f: '1\n' });
    const a = r.commit('a');
    r.git('checkout', '-q', '-b', 'work');
    r.write('g', 'x\n'); r.commit('work');
    r.git('checkout', '-q', 'main');
    r.write('h', 'y\n'); r.commit('main moves');
    const m = r.merge('work');
    expect(parents(r.dir, a)).toEqual([]);
    expect(parents(r.dir, m)).toHaveLength(2);
    expect(commitMessage(r.dir, m)).toBe('merge work');
  });

  it('writes, reads, lists and overwrites whyline notes', () => {
    const r = makeRepo({ f: '1\n' });
    const a = r.commit('a');
    expect(noteShow(r.dir, a)).toBeNull();
    expect(noteList(r.dir).size).toBe(0);
    expect(noteAdd(r.dir, a, '{"v":1}\n')).toBe(true);
    expect(noteShow(r.dir, a)).toBe('{"v":1}\n');
    expect(noteAdd(r.dir, a, '{"v":2}\n')).toBe(true);
    expect(noteShow(r.dir, a)).toBe('{"v":2}\n');
    expect([...noteList(r.dir)]).toEqual([a]);
    expect(r.git('notes', '--ref', 'whyline', 'show', a)).toBe('{"v":2}');
  });

  it('resolves the hooks dir and reads config', () => {
    const r = makeRepo({});
    expect(hooksDir(r.dir)).toBe(`${r.dir}/.git/hooks`);
    expect(configGet(r.dir, 'user.signingkey')).toBeNull();
    r.git('config', 'whyline.sign', 'true');
    expect(configGet(r.dir, 'whyline.sign')).toBe('true');
  });
});
