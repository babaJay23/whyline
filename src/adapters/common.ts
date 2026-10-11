import { realpathSync } from 'node:fs';

export function real(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

/** True when cwd is root or lies inside it, comparing resolved paths. */
export function inside(root: string, cwd: string): boolean {
  const r = real(root), c = real(cwd);
  return c === r || c.startsWith(r.endsWith('/') ? r : r + '/');
}

/** Tokens that look like file paths: contain a slash or end in a short extension. Best effort, used only for hints. */
export function pathTokens(command: string): string[] {
  const out = new Set<string>();
  for (const raw of command.split(/[\s'"`;|&()<>]+/)) {
    const t = raw.replace(/^[-=]+/, '');
    if (!t || t.startsWith('http')) continue;
    if (t.includes('/') || /\.[a-z0-9]{1,5}$/i.test(t)) {
      if (/^[\w./~-]+$/.test(t) && t !== '.' && t !== '..') out.add(t);
    }
  }
  return [...out];
}
