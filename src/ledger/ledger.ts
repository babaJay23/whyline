import type { EditEvent, LedgerLine, LineTable } from '../types.js';
import { splitLines } from '../lines.js';

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
    const newText = curText.slice(0, from) + neu + curText.slice(to);
    const newLines = splitLines(newText);
    const startLine = lineIndexAt(curText, from);
    // The line at `to` survives intact only if the span ended at a line boundary
    // and the replacement text also ends at one; otherwise it is joined into the edit.
    const endsAtBoundary = atLineStart(curText, to) && atLineStart(newText, from + neu.length);
    const endLine = Math.min(cur.length - 1, Math.max(startLine, endsAtBoundary ? lineIndexAt(curText, to - 1) : lineIndexAt(curText, to)));
    const headCount = startLine;
    const tailCount = Math.max(0, cur.length - endLine - 1);
    const produced = newLines.length - headCount - tailCount;
    const oldSpan = cur.slice(startLine, endLine + 1);
    const out: LedgerLine[] = cur.slice(0, headCount);
    for (let i = 0; i < produced; i++) out.push({ text: newLines[headCount + i]!, editId });
    keepUnchangedContext(out, headCount, produced, oldSpan);
    for (let i = 0; i < tailCount; i++) out.push(cur[endLine + 1 + i]!);
    cur = out;
    curText = newText;
    if (!all) break;
    from = curText.indexOf(old, from + neu.length);
  }
  return cur;
}

/**
 * Harness edits carry unchanged neighbouring lines for uniqueness. Those lines
 * were not rewritten, so they keep the attribution they already had.
 */
function keepUnchangedContext(out: LedgerLine[], offset: number, produced: number, oldSpan: LedgerLine[]): void {
  let lead = 0;
  while (lead < produced && lead < oldSpan.length && out[offset + lead]!.text === oldSpan[lead]!.text) {
    out[offset + lead] = oldSpan[lead]!;
    lead++;
  }
  let trail = 0;
  while (trail < produced - lead && trail < oldSpan.length - lead && out[offset + produced - 1 - trail]!.text === oldSpan[oldSpan.length - 1 - trail]!.text) {
    out[offset + produced - 1 - trail] = oldSpan[oldSpan.length - 1 - trail]!;
    trail++;
  }
}

function atLineStart(text: string, offset: number): boolean {
  return offset === 0 || text.charCodeAt(offset - 1) === 10;
}

function lineIndexAt(text: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
