import { describe, it, expect } from 'vitest';
import { makeRepo } from './helpers/tmp-repo.js';
import { repoRoot, commitTime, show, diffText, untracked, readWorkingFile, parseRange, mergeBase } from '../src/git.js';

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
