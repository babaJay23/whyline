import { commitMessage, commitTime, diffText, lsTree, noteAdd, parents, show } from './git.js';
import { specReferences } from './spec-refs.js';
import { buildRecord, type IntentRecord } from './record.js';
import { parseUnifiedDiff } from './resolve/diff.js';
import { resolve } from './resolve/resolve.js';
import type { RepoFiles } from './resolve/flags.js';
import { findSessions } from './sessions.js';
import type { PriceTable } from './pricing.js';
import { signHash, signingKey } from './sign.js';

export interface AttachOptions {
  prompts: boolean;
  prices?: PriceTable;
  now: number;
  home: string;
  sign?: boolean;
  key?: string;
}

export type AttachResult =
  | { sha: string; status: 'attached'; record: IntentRecord }
  | { sha: string; status: 'skipped-merge' }
  | { sha: string; status: 'no-sessions' }
  | { sha: string; status: 'write-failed' }
  | { sha: string; status: 'sign-failed'; reason: string };

export async function attachCommits(root: string, shas: string[], opts: AttachOptions): Promise<AttachResult[]> {
  const out: AttachResult[] = [];
  for (const sha of shas) {
    if (parents(root, sha).length > 1) { out.push({ sha, status: 'skipped-merge' }); continue; }
    const record = await recordFor(root, sha, opts);
    if (!record) { out.push({ sha, status: 'no-sessions' }); continue; }
    if (opts.sign) {
      const k = signingKey(root, opts.key);
      if (typeof k === 'string') { out.push({ sha, status: 'sign-failed', reason: k }); continue; }
      const sig = signHash(record.hash, k.key, k.signer);
      if (typeof sig === 'string') { out.push({ sha, status: 'sign-failed', reason: sig }); continue; }
      record.signature = sig;
    }
    const ok = noteAdd(root, sha, JSON.stringify(record, null, 2) + '\n');
    out.push(ok ? { sha, status: 'attached', record } : { sha, status: 'write-failed' });
  }
  return out;
}

/** Resolve one commit against its first parent from local transcripts; null when no session overlaps. */
export async function recordFor(root: string, sha: string, opts: AttachOptions): Promise<IntentRecord | null> {
  const [parent] = parents(root, sha);
  const window = { from: parent ? commitTime(root, parent) : 0, to: commitTime(root, sha) };
  const { selected } = await findSessions(root, opts.home, { window });
  if (selected.length === 0) return null;

  const range = parent ? `${parent}..${sha}` : sha;
  const diffs = parseUnifiedDiff(diffText(root, `${parent ?? EMPTY_TREE} ${sha}`));
  const tree = new Set(lsTree(root, sha));
  const repo: RepoFiles = {
    has: (p) => tree.has(p),
    byBasename: (n) => [...tree].filter((p) => p.split('/').pop() === n),
    read: (p) => show(root, sha, p),
  };
  const diff = resolve({
    repoRoot: root, range, window, diffs, sessions: selected,
    baseText: (p) => (parent ? show(root, parent, p) : null),
    headText: (p) => show(root, sha, p),
    repo, now: opts.now, ...(opts.prices ? { prices: opts.prices } : {}),
    extraSpecRefs: specReferences(commitMessage(root, sha)),
  });
  return buildRecord(sha, diff, { prompts: opts.prompts, now: opts.now });
}

/** git's well-known empty tree, so a root commit diffs against nothing. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
