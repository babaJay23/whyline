import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

export function repoRoot(cwd: string): string | null {
  const out = git(cwd, ['rev-parse', '--show-toplevel']);
  return out ? out.trim() : null;
}

export function hasCommits(root: string): boolean {
  return git(root, ['rev-parse', '--verify', '-q', 'HEAD']) !== null;
}

export function commitTime(root: string, rev: string): number {
  const out = git(root, ['show', '-s', '--format=%ct', rev]);
  if (!out) throw new Error(`cannot read commit time for ${rev}`);
  return Number(out.trim()) * 1000;
}

export function show(root: string, rev: string, path: string): string | null {
  return git(root, ['show', `${rev}:${path}`]);
}

export function diffText(root: string, range: string | null): string {
  const args = ['diff', '--unified=0', '--no-color', '--no-ext-diff', '--find-renames'];
  args.push(...(range ?? 'HEAD').split(' ')); // "a b" compares two commits directly
  return git(root, args) ?? '';
}

export function untracked(root: string): string[] {
  const out = git(root, ['ls-files', '--others', '--exclude-standard']);
  return out ? out.split('\n').filter(Boolean) : [];
}

export function lsFiles(root: string): string[] {
  const out = git(root, ['ls-files', '-z']);
  return out ? out.split('\0').filter(Boolean) : [];
}

export function readWorkingFile(root: string, path: string): string | null {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch {
    return null;
  }
}

export function mergeBase(root: string, a: string, b: string): string | null {
  const out = git(root, ['merge-base', a, b]);
  return out ? out.trim() : null;
}

export function parseRange(range: string | null): { base: string; head: string | null } {
  if (!range) return { base: 'HEAD', head: null };
  const m = /^(.*?)\.{2,3}(.*)$/.exec(range);
  if (!m) return { base: range, head: null };
  return { base: m[1]!, head: m[2] || 'HEAD' };
}

const NOTES_REF = 'refs/notes/whyline';

/** Commits in a range, oldest first; a bare rev means that one commit. */
export function revList(root: string, range: string): string[] {
  if (!range.includes('..')) {
    const one = git(root, ['rev-parse', '--verify', '-q', `${range}^{commit}`]);
    return one ? [one.trim()] : [];
  }
  const { base, head } = parseRange(range);
  const out = git(root, ['rev-list', '--reverse', `${base}..${head ?? 'HEAD'}`, '--']);
  return out ? out.split('\n').filter(Boolean) : [];
}

export function parents(root: string, sha: string): string[] {
  const out = git(root, ['rev-list', '--parents', '-n', '1', sha]);
  return out ? out.trim().split(' ').slice(1) : [];
}

export function commitMessage(root: string, sha: string): string {
  return (git(root, ['show', '-s', '--format=%B', sha]) ?? '').trim();
}

export function lsTree(root: string, sha: string): string[] {
  const out = git(root, ['ls-tree', '-r', '--name-only', '-z', sha]);
  return out ? out.split('\0').filter(Boolean) : [];
}

export function gitDir(root: string): string {
  return resolvePath(root, (git(root, ['rev-parse', '--git-dir']) ?? '.git').trim());
}

export function noteShow(root: string, sha: string): string | null {
  return git(root, ['notes', '--ref', NOTES_REF, 'show', sha]);
}

export function noteAdd(root: string, sha: string, text: string): boolean {
  try {
    execFileSync('git', ['notes', '--ref', NOTES_REF, 'add', '-f', '-F', '-', sha], { cwd: root, input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

export function noteList(root: string): Set<string> {
  const out = git(root, ['notes', '--ref', NOTES_REF, 'list']);
  return new Set((out ?? '').split('\n').filter(Boolean).map((l) => l.split(' ')[1]!));
}

export function pushNotes(root: string, remote: string): string | null {
  return gitErr(root, ['push', remote, `${NOTES_REF}:${NOTES_REF}`]);
}

export function fetchNotes(root: string, remote: string): string | null {
  return gitErr(root, ['fetch', remote, `+${NOTES_REF}:${NOTES_REF}`]);
}

/** Like git() but returns stderr text on failure, for commands whose error the user needs to see. */
function gitErr(root: string, args: string[]): string | null {
  try {
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
    return null;
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    return (err.stderr ?? err.message).trim();
  }
}

export function hooksDir(root: string): string {
  const out = git(root, ['rev-parse', '--git-path', 'hooks']) ?? '.git/hooks';
  return resolvePath(root, out.trim());
}

export function configGet(root: string, key: string): string | null {
  const out = git(root, ['config', '--get', key]);
  return out ? out.trim() : null;
}
