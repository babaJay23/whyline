import { describe, it, expect } from 'vitest';
import { parseApplyPatch } from '../src/adapters/apply-patch.js';

describe('parseApplyPatch', () => {
  it('turns Add File into a write', () => {
    const r = parseApplyPatch('*** Begin Patch\n*** Add File: /r/a.py\n+x = 1\n+y = 2\n*** End Patch\n');
    expect(r).toEqual([{ file: '/r/a.py', op: { type: 'write', content: 'x = 1\ny = 2\n' } }]);
  });

  it('turns each Update chunk into a replace with context preserved on both sides', () => {
    const r = parseApplyPatch([
      '*** Begin Patch', '*** Update File: /r/b.ts',
      '@@', ' keep', '-old', '+new', ' tail',
      '@@ function g', '-  return 1;', '+  return 2;',
      '*** End Patch', '',
    ].join('\n'));
    expect(r).toEqual([
      { file: '/r/b.ts', op: { type: 'replace', old: 'keep\nold\ntail', new: 'keep\nnew\ntail', all: false } },
      { file: '/r/b.ts', op: { type: 'replace', old: '  return 1;', new: '  return 2;', all: false } },
    ]);
  });

  it('turns Delete File into a delete', () => {
    expect(parseApplyPatch('*** Begin Patch\n*** Delete File: /r/c\n*** End Patch')).toEqual([{ file: '/r/c', op: { type: 'delete' } }]);
  });

  it('handles Move to by deleting the source and updating the destination', () => {
    const r = parseApplyPatch('*** Begin Patch\n*** Update File: /r/old.ts\n*** Move to: /r/new.ts\n@@\n-a\n+b\n*** End Patch');
    expect(r).toEqual([
      { file: '/r/old.ts', op: { type: 'delete' } },
      { file: '/r/new.ts', op: { type: 'replace', old: 'a', new: 'b', all: false } },
    ]);
  });

  it('returns [] for garbage', () => {
    expect(parseApplyPatch('not a patch')).toEqual([]);
    expect(parseApplyPatch('')).toEqual([]);
  });
});
