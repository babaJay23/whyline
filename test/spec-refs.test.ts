import { describe, it, expect } from 'vitest';
import { specReferences } from '../src/spec-refs.js';

describe('specReferences', () => {
  it('finds issue ids, urls and spec-like paths', () => {
    expect(specReferences('implement #449 per docs/design.md and PROJ-12')).toEqual(['#449', 'docs/design.md', 'PROJ-12']);
    expect(specReferences('see https://example.com/spec for the plan')).toEqual(['https://example.com/spec']);
    expect(specReferences('follow adr-045.md and the api_spec.yaml')).toEqual(['adr-045.md', 'api_spec.yaml']);
  });
  it('ignores ordinary prose and code', () => {
    expect(specReferences('fix the failing tests in src/a.ts')).toEqual([]);
    expect(specReferences('use #!/bin/sh and item #1 in the list')).toEqual([]); // #1 alone is too short to be an issue
    expect(specReferences('encode as UTF-8, hash with SHA-256, dates in ISO-8601, fix CVE-2026-1')).toEqual([]);
    expect(specReferences('edit planner.ts, inspect.ts and explanation.md')).toEqual([]); // keywords inside other words
    expect(specReferences('see design.md, the plan.md and api-spec.yaml')).toEqual(['design.md', 'plan.md', 'api-spec.yaml']);
  });
});
