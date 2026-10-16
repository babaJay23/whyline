import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gitDir, hooksDir } from './git.js';

export const HOOK_BEGIN = '# >>> whyline';
export const HOOK_END = '# <<< whyline';

export function hookLine(opts: { sign: boolean; prompts: boolean }): string {
  return `whyline attach HEAD --quiet${opts.sign ? ' --sign' : ''}${opts.prompts ? '' : ' --no-prompts'} || true`;
}

function hookPath(root: string): string {
  return join(hooksDir(root), 'post-commit');
}

function block(line: string): string {
  return `${HOOK_BEGIN}\n${line}\n${HOOK_END}\n`;
}

function stripBlock(text: string): string {
  const a = text.indexOf(HOOK_BEGIN);
  if (a === -1) return text;
  const b = text.indexOf(HOOK_END, a);
  const end = b === -1 ? text.length : b + HOOK_END.length + (text[b + HOOK_END.length] === '\n' ? 1 : 0);
  return text.slice(0, a) + text.slice(end);
}

/** Append (or refresh) the marked block in post-commit; an existing hook keeps everything else it had. */
export function installHook(root: string, opts: { sign: boolean; prompts: boolean }): { path: string; created: boolean } {
  const path = hookPath(root);
  const created = !existsSync(path);
  mkdirSync(dirname(path), { recursive: true });
  const existing = created ? '#!/bin/sh\n' : readFileSync(path, 'utf8');
  const shebang = existing.split('\n')[0] ?? '';
  if (shebang.startsWith('#!') && !/\b(sh|bash|zsh|dash|ksh)\b/.test(shebang)) {
    throw new Error(`${path} is not a shell script (${shebang}); add this line to it yourself:\n${hookLine(opts)}`);
  }
  let base = stripBlock(existing);
  if (!base.endsWith('\n')) base += '\n';
  writeFileSync(path, base + block(hookLine(opts)));
  chmodSync(path, 0o755);
  return { path, created };
}

export function uninstallHook(root: string): { path: string; removed: boolean; fileDeleted: boolean } {
  const path = hookPath(root);
  if (!existsSync(path)) return { path, removed: false, fileDeleted: false };
  const text = readFileSync(path, 'utf8');
  if (!text.includes(HOOK_BEGIN)) return { path, removed: false, fileDeleted: false };
  const rest = stripBlock(text);
  if (/^#![^\n]*\n\s*$/.test(rest)) { unlinkSync(path); return { path, removed: true, fileDeleted: true }; }
  writeFileSync(path, rest);
  return { path, removed: true, fileDeleted: false };
}

export function hookStatus(root: string): { installed: boolean; path: string; line: string | null } {
  const path = hookPath(root);
  if (!existsSync(path)) return { installed: false, path, line: null };
  const m = new RegExp(`${HOOK_BEGIN}\\n(.*)\\n${HOOK_END}`).exec(readFileSync(path, 'utf8'));
  return m ? { installed: true, path, line: m[1]! } : { installed: false, path, line: null };
}

export function lastError(root: string): string | null {
  try { return readFileSync(join(gitDir(root), 'whyline-last-error'), 'utf8').trim(); } catch { return null; }
}

export function writeLastError(root: string, text: string): void {
  try { writeFileSync(join(gitDir(root), 'whyline-last-error'), `${new Date().toISOString()} ${text}\n`); } catch { /* best effort; doctor reports what it can */ }
}

export function clearLastError(root: string): void {
  try { unlinkSync(join(gitDir(root), 'whyline-last-error')); } catch { /* nothing to clear */ }
}

/** The hook runs `whyline` by name; without it on PATH every commit will print "command not found". */
export function onPath(env: NodeJS.ProcessEnv): boolean {
  for (const dir of (env.PATH ?? '').split(':').filter(Boolean)) {
    try { if (statSync(join(dir, 'whyline')).isFile()) return true; } catch { /* keep looking */ }
  }
  return false;
}
