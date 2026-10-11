import type { EditOp } from '../types.js';

export function parseApplyPatch(input: string): { file: string; op: EditOp }[] {
  if (!input.includes('*** Begin Patch')) return [];
  const out: { file: string; op: EditOp }[] = [];
  const lines = input.split('\n');

  let file: string | null = null;
  let mode: 'add' | 'update' | null = null;
  let added: string[] = [];
  let chunk: { old: string[]; neu: string[] } | null = null;

  const flushChunk = () => {
    if (file && chunk && (chunk.old.length || chunk.neu.length)) {
      out.push({ file, op: { type: 'replace', old: chunk.old.join('\n'), new: chunk.neu.join('\n'), all: false } });
    }
    chunk = null;
  };
  const flushFile = () => {
    if (file && mode === 'add') out.push({ file, op: { type: 'write', content: added.length ? added.join('\n') + '\n' : '' } });
    if (mode === 'update') flushChunk();
    file = null; mode = null; added = []; chunk = null;
  };

  for (const line of lines) {
    if (line.startsWith('*** Add File: ')) { flushFile(); file = line.slice(14).trim(); mode = 'add'; continue; }
    if (line.startsWith('*** Update File: ')) { flushFile(); file = line.slice(17).trim(); mode = 'update'; continue; }
    if (line.startsWith('*** Delete File: ')) { flushFile(); out.push({ file: line.slice(17).trim(), op: { type: 'delete' } }); continue; }
    if (line.startsWith('*** Move to: ') && file && mode === 'update') {
      out.push({ file, op: { type: 'delete' } });
      file = line.slice(13).trim();
      continue;
    }
    if (line.startsWith('*** End Patch')) { flushFile(); break; }
    if (line.startsWith('*** ')) continue; // Begin Patch and anything unknown

    if (mode === 'add') {
      if (line.startsWith('+')) added.push(line.slice(1));
      continue;
    }
    if (mode === 'update') {
      if (line.startsWith('@@')) { flushChunk(); chunk = { old: [], neu: [] }; continue; }
      if (!chunk) chunk = { old: [], neu: [] };
      if (line.startsWith('-')) chunk.old.push(line.slice(1));
      else if (line.startsWith('+')) chunk.neu.push(line.slice(1));
      else if (line.startsWith(' ')) { chunk.old.push(line.slice(1)); chunk.neu.push(line.slice(1)); }
      else if (line === '') { chunk.old.push(''); chunk.neu.push(''); } // some Codex versions emit blank context without the leading space
    }
  }
  flushFile();
  return out;
}
