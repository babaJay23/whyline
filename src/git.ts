import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  args.push(range ?? 'HEAD');
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
