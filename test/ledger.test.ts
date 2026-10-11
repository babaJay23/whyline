import { describe, it, expect } from 'vitest';
import { replay, tableText } from '../src/ledger/ledger.js';
import type { EditEvent, EditOp } from '../src/types.js';

let n = 0;
function edit(file: string, op: EditOp, at = ++n): EditEvent {
  return { kind: 'edit', id: `e${at}`, sessionId: 's', agentId: 's', turnId: 't', at, tool: 'Edit', file, op };
}

describe('replay', () => {
  it('attributes every line of a write to that edit', () => {
    const t = replay(null, [edit('f', { type: 'write', content: 'a\nb\n' })]);
    expect(t.lines).toEqual([{ text: 'a', editId: 'e1' }, { text: 'b', editId: 'e1' }]);
    expect(t.driftedAt).toBeNull();
  });

  it('base lines start unattributed', () => {
    const t = replay('x\ny\n', []);
    expect(t.lines.map((l) => l.editId)).toEqual([null, null]);
  });

  it('replace attributes only the replaced span and keeps neighbours', () => {
    const e = edit('f', { type: 'replace', old: 'two', new: 'TWO\nTWO-B', all: false });
    const t = replay('one\ntwo\nthree\n', [e]);
    expect(t.lines).toEqual([
      { text: 'one', editId: null },
      { text: 'TWO', editId: e.id },
      { text: 'TWO-B', editId: e.id },
      { text: 'three', editId: null },
    ]);
  });

  it('replace of a span that starts mid-line attributes the whole touched lines', () => {
    const e = edit('f', { type: 'replace', old: 'return 1', new: 'return 2', all: false });
    const t = replay('  return 1;\n', [e]);
    expect(t.lines).toEqual([{ text: '  return 2;', editId: e.id }]);
  });

  it('replace_all: false touches the first occurrence only; true touches all', () => {
    const first = edit('f', { type: 'replace', old: 'x', new: 'y', all: false });
    expect(tableText(replay('x\nx\n', [first]))).toBe('y\nx\n');
    const all = edit('f', { type: 'replace', old: 'x', new: 'y', all: true });
    const t = replay('x\nx\n', [all]);
    expect(tableText(t)).toBe('y\ny\n');
    expect(t.lines.map((l) => l.editId)).toEqual([all.id, all.id]);
  });

  it('a later edit overrides attribution of lines it rewrites', () => {
    const a = edit('f', { type: 'write', content: 'a\nb\nc\n' });
    const b = edit('f', { type: 'replace', old: 'b', new: 'B', all: false });
    const t = replay(null, [a, b]);
    expect(t.lines.map((l) => l.editId)).toEqual([a.id, b.id, a.id]);
  });

  it('records a failed match as drift and keeps replaying later edits', () => {
    const bad = edit('f', { type: 'replace', old: 'nope', new: 'z', all: false }, 10);
    const good = edit('f', { type: 'replace', old: 'a', new: 'A', all: false }, 11);
    const t = replay('a\n', [bad, good]);
    expect(t.driftedAt).toBe(10);
    expect(t.failed).toEqual(['e10']);
    expect(t.lines).toEqual([{ text: 'A', editId: 'e11' }]);
  });

  it('delete empties the table', () => {
    const t = replay('a\n', [edit('f', { type: 'delete' })]);
    expect(t.lines).toEqual([]);
  });

  it('keeps \\r so CRLF files match byte-exactly', () => {
    const e = edit('f', { type: 'replace', old: 'a\r\nb', new: 'a\r\nB', all: false });
    const t = replay('a\r\nb\r\n', [e]);
    expect(t.lines.map((l) => l.text)).toEqual(['a\r', 'B\r']);
    expect(t.driftedAt).toBeNull();
  });

  it('handles a file without a trailing newline', () => {
    const e = edit('f', { type: 'replace', old: 'b', new: 'B', all: false });
    expect(tableText(replay('a\nb', [e]))).toBe('a\nB\n');
  });

  it('matches an old string that includes the final newline of the file', () => {
    const e = edit('f', { type: 'replace', old: 'c\n', new: 'c\nd\n', all: false });
    const t = replay('a\nb\nc\n', [e]);
    expect(t.driftedAt).toBeNull();
    expect(t.lines.map((l) => [l.text, l.editId])).toEqual([['a', null], ['b', null], ['c', null], ['d', e.id]]); // c was context, only d was written
  });

  it('keeps the following line when old ends in a newline and new does not', () => {
    const e = edit('f', { type: 'replace', old: 'b\n', new: 'B', all: false });
    expect(tableText(replay('a\nb\nc\n', [e]))).toBe('a\nBc\n');
    const join = edit('f', { type: 'replace', old: '\nb\n', new: '', all: false });
    expect(tableText(replay('a\nb\nc\n', [join]))).toBe('ac\n');
  });

  it('leaves attribution of unchanged context lines with the edit that wrote them', () => {
    const w = edit('f', { type: 'write', content: 'one\ntwo\nthree\nfour\n' });
    const e = edit('f', { type: 'replace', old: 'two\nthree\nfour', new: 'two\nTHREE\nfour', all: false });
    const t = replay(null, [w, e]);
    expect(t.lines.map((l) => [l.text, l.editId])).toEqual([['one', w.id], ['two', w.id], ['THREE', e.id], ['four', w.id]]);
  });

  it('tableText of an empty table is empty', () => {
    expect(tableText(replay(null, []))).toBe('');
  });
});
