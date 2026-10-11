import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findSessions } from '../src/sessions.js';

const HOME = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'home');
const T = (s: string) => Date.parse(s);

describe('findSessions', () => {
  it('returns both harnesses when the window overlaps them', async () => {
    const { selected, all } = await findSessions('/repo', HOME, { window: { from: T('2026-10-01T09:00:00Z'), to: T('2026-10-01T11:00:00Z') } });
    expect(all.map((r) => r.id)).toEqual(['cx-1', 'sess-1']); // codex fixture starts one second earlier
    expect(selected.map((s) => s.ref.id)).toEqual(['cx-1', 'sess-1']);
    expect(selected[0]!.events.length).toBeGreaterThan(5);
  });

  it('excludes sessions outside the window but still lists them in all', async () => {
    const { selected, all } = await findSessions('/repo', HOME, { window: { from: T('2026-10-02T00:00:00Z'), to: T('2026-10-03T00:00:00Z') } });
    expect(selected).toEqual([]);
    expect(all).toHaveLength(2);
  });

  it('selects every session with all: true', async () => {
    const { selected } = await findSessions('/repo', HOME, { all: true });
    expect(selected.map((s) => s.ref.id)).toEqual(['cx-1', 'sess-1']);
  });

  it('selects by id prefix and ignores the window when ids are given', async () => {
    const { selected } = await findSessions('/repo', HOME, { window: { from: 0, to: 1 }, ids: ['cx'] });
    expect(selected.map((s) => s.ref.id)).toEqual(['cx-1']);
  });
});
