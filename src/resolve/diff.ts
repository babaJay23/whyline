import type { FileDiff, FileStatus, Hunk } from '../types.js';

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let binary = false;

  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      if (cur && !binary) files.push(cur);
      cur = { path: '', oldPath: null, status: 'modified', hunks: [] };
      hunk = null;
      binary = false;
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('Binary files ')) { binary = true; continue; }
    if (raw.startsWith('new file mode')) { cur.status = 'added'; continue; }
    if (raw.startsWith('deleted file mode')) { cur.status = 'deleted'; continue; }
    if (raw.startsWith('rename from ')) { cur.oldPath = raw.slice('rename from '.length); cur.status = 'renamed'; continue; }
    if (raw.startsWith('rename to ')) { cur.path = raw.slice('rename to '.length); continue; }
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4);
      if (p !== '/dev/null' && !cur.path && cur.status !== 'renamed') cur.path = p.replace(/^a\//, '');
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4);
      if (p !== '/dev/null') cur.path = p.replace(/^b\//, '');
      continue;
    }
    const m = HUNK.exec(raw);
    if (m) {
      hunk = {
        oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]), newLines: m[4] === undefined ? 1 : Number(m[4]),
        removed: [], added: [],
      };
      cur.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (raw.startsWith('+')) hunk.added.push(raw.slice(1));
    else if (raw.startsWith('-')) hunk.removed.push(raw.slice(1));
    // "\ No newline at end of file" and anything else: ignore
  }
  if (cur && !binary) files.push(cur);
  return files;
}

export function syntheticAdded(path: string, content: string): FileDiff {
  const lines = splitLines(content);
  const status: FileStatus = 'added';
  if (lines.length === 0) return { path, oldPath: null, status, hunks: [] };
  return {
    path, oldPath: null, status,
    hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, removed: [], added: lines }],
  };
}

/** Split on \n only, drop the empty tail after a final newline, keep \r inside lines. */
export function splitLines(content: string): string[] {
  if (content === '') return [];
  const parts = content.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}
