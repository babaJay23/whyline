import type { EditEvent, LedgerLine, LineTable } from '../types.js';
import { splitLines } from '../resolve/diff.js';

export function replay(base: string | null, edits: EditEvent[]): LineTable {
  let lines: LedgerLine[] = splitLines(base ?? '').map((text) => ({ text, editId: null }));
  let driftedAt: number | null = null;
  const failed: string[] = [];

  for (const e of [...edits].sort((a, b) => a.at - b.at)) {
    switch (e.op.type) {
      case 'write':
        lines = splitLines(e.op.content).map((text) => ({ text, editId: e.id }));
        break;
      case 'delete':
        lines = [];
        break;
      case 'replace': {
        const next = applyReplace(lines, e.op.old, e.op.new, e.op.all, e.id);
        if (next === null) {
          failed.push(e.id);
          if (driftedAt === null) driftedAt = e.at;
        } else {
          lines = next;
        }
      }
    }
  }
  return { lines, driftedAt, failed };
}

export function tableText(t: LineTable): string {
  return t.lines.length === 0 ? '' : t.lines.map((l) => l.text).join('\n') + '\n';
}

function applyReplace(lines: LedgerLine[], old: string, neu: string, all: boolean, editId: string): LedgerLine[] | null {
  if (old === '') return null;
  // The harness matched against the real file, which usually ends in a newline
  // that the line table does not store. Try with it first, then without.
  const joined = lines.map((l) => l.text).join('\n');
  let curText = joined + '\n';
  let from = curText.indexOf(old);
  if (from === -1) { curText = joined; from = curText.indexOf(old); }
  if (from === -1) return null;

  let cur = lines;
  while (from !== -1) {
    const to = from + old.length;
    const startLine = lineIndexAt(curText, from);
    const endLine = lineIndexAt(curText, Math.max(from, to - 1));
    const newText = curText.slice(0, from) + neu + curText.slice(to);
    const newLines = splitLines(newText);
    // Lines before startLine and after endLine are untouched; everything between
    // (inclusive) was produced by this replacement.
    const tailCount = cur.length - endLine - 1;
    const headCount = startLine;
    const produced = newLines.length - headCount - tailCount;
    const out: LedgerLine[] = [];
    for (let i = 0; i < headCount; i++) out.push(cur[i]!);
    for (let i = 0; i < produced; i++) out.push({ text: newLines[headCount + i]!, editId });
    for (let i = 0; i < tailCount; i++) out.push(cur[endLine + 1 + i]!);
    cur = out;
    curText = newText;
    if (!all) break;
    from = curText.indexOf(old, from + neu.length);
  }
  return cur;
}

function lineIndexAt(text: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
