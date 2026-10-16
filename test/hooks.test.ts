import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/tmp-repo.js';
import { installHook, uninstallHook, hookStatus, hookLine, HOOK_BEGIN, HOOK_END } from '../src/hooks.js';

describe('hooks', () => {
  it('creates an executable post-commit hook and removes it cleanly', () => {
    const r = makeRepo({});
    expect(hookStatus(r.dir).installed).toBe(false);
    const { path, created } = installHook(r.dir, { sign: false, prompts: true });
    expect(created).toBe(true);
    expect(path).toBe(join(r.dir, '.git', 'hooks', 'post-commit'));
    expect(statSync(path).mode & 0o111).not.toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(`#!/bin/sh\n${HOOK_BEGIN}\nwhyline attach HEAD --quiet || true\n${HOOK_END}\n`);
    expect(hookStatus(r.dir)).toEqual({ installed: true, path, line: 'whyline attach HEAD --quiet || true' });
    installHook(r.dir, { sign: true, prompts: false }); // idempotent, updates the line
    expect(hookStatus(r.dir).line).toBe('whyline attach HEAD --quiet --sign --no-prompts || true');
    expect(readFileSync(path, 'utf8').split(HOOK_BEGIN)).toHaveLength(2);
    expect(uninstallHook(r.dir)).toEqual({ path, removed: true, fileDeleted: true });
    expect(existsSync(path)).toBe(false);
  });

  it('appends to an existing hook and leaves the rest intact', () => {
    const r = makeRepo({});
    const path = join(r.dir, '.git', 'hooks', 'post-commit');
    writeFileSync(path, '#!/bin/bash\necho theirs\n', { mode: 0o755 });
    expect(installHook(r.dir, { sign: false, prompts: true }).created).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(`#!/bin/bash\necho theirs\n${HOOK_BEGIN}\n${hookLine({ sign: false, prompts: true })}\n${HOOK_END}\n`);
    expect(uninstallHook(r.dir)).toEqual({ path, removed: true, fileDeleted: false });
    expect(readFileSync(path, 'utf8')).toBe('#!/bin/bash\necho theirs\n');
    expect(uninstallHook(r.dir).removed).toBe(false);
  });

  it('refuses to append a shell line to a hook written in another language', () => {
    const r = makeRepo({});
    const path = join(r.dir, '.git', 'hooks', 'post-commit');
    writeFileSync(path, '#!/usr/bin/env python3\nprint("theirs")\n', { mode: 0o755 });
    expect(() => installHook(r.dir, { sign: false, prompts: true })).toThrow(/python3/);
    expect(readFileSync(path, 'utf8')).toBe('#!/usr/bin/env python3\nprint("theirs")\n');
  });

  it('honors core.hooksPath', () => {
    const r = makeRepo({});
    r.git('config', 'core.hooksPath', '.githooks');
    const { path } = installHook(r.dir, { sign: false, prompts: true });
    expect(path).toBe(join(r.dir, '.githooks', 'post-commit'));
    expect(existsSync(path)).toBe(true);
  });
});
