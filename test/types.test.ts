import { describe, it, expect } from 'vitest';
import type { Event, EditOp, SessionRef } from '../src/types.js';

describe('types', () => {
  it('compile and narrow by kind', () => {
    const ref: SessionRef = {
      harness: 'claude-code', id: 's1', path: '/x/s1.jsonl', cwd: '/repo',
      startedAt: 1, endedAt: 2,
    };
    const op: EditOp = { type: 'replace', old: 'a', new: 'b', all: false };
    const e: Event = {
      kind: 'edit', id: 'e1', sessionId: ref.id, agentId: ref.id, turnId: 't1', at: 1,
      tool: 'Edit', file: 'src/a.ts', op,
    };
    expect(e.kind === 'edit' ? e.file : null).toBe('src/a.ts');
  });
});
