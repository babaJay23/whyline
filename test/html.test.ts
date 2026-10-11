import { describe, it, expect } from 'vitest';
import { renderHtml } from '../src/render/html.js';
import type { AnnotatedDiff } from '../src/types.js';

const diff: AnnotatedDiff = {
  schemaVersion: 1, range: 'HEAD..working tree', generatedAt: 0, sessions: [],
  files: [{
    path: 'src/<a>.ts', status: 'modified', turnIds: ['p1'], cost: null, ledgerMismatch: false, driftedAt: null,
    hunks: [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, removed: ['<b>'], lines: [{ text: 'x && y', provenance: null }], lead: null, otherTurns: 0, flags: [{ flag: 'untraced', detail: 'no structured edit covers these lines' }] },
      { oldStart: 3, oldLines: 0, newStart: 3, newLines: 1, removed: [], lines: [{ text: 'ok', provenance: { harness: 'codex', sessionId: 's', turnId: 'p1', agentId: 's', agentName: null, prompt: { text: 'add "ok"', at: 0 }, reasoning: null, tool: 'apply_patch', editId: 'c', at: 0, turnCost: null } }], lead: { harness: 'codex', sessionId: 's', turnId: 'p1', agentId: 's', agentName: null, prompt: { text: 'add "ok"', at: 0 }, reasoning: null, tool: 'apply_patch', editId: 'c', at: 0, turnCost: null }, otherTurns: 0, flags: [] },
    ],
  }],
  totals: { files: 1, hunks: 2, flagged: { untraced: 1, unrequested: 0, 'after-correction': 0, subagent: 0, churned: 0, drifted: 0 }, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
};

describe('renderHtml', () => {
  const html = renderHtml(diff);

  it('is a complete document with the verdict in the title and body', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>whyline: 2 hunks across 1 file, 1 needs a look: 1 untraced</title>');
    expect(html).toContain('1 needs a look');
  });

  it('escapes paths, code and prompts', () => {
    expect(html).toContain('src/&lt;a&gt;.ts');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('x &amp;&amp; y');
    expect(html).toContain('add &quot;ok&quot;');
    expect(html).not.toContain('<b>');
  });

  it('references nothing external', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<script src');
    expect(html).not.toContain('<link');
  });

  it('gives every hunk a unique id and links each file to its first rendered hunk', () => {
    const ids = [...html.matchAll(/<article class="hunk" id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const href of [...html.matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1])) expect(ids).toContain(href);
    expect(html).not.toMatch(/id="[^"]*[<>#\s][^"]*"/);
  });

  it('renders flag chips and keeps unflagged hunks collapsed', () => {
    expect(html).toContain('class="chip untraced"');
    expect(html).toMatch(/<details class="unflagged">\s*<summary>/);
  });
});
