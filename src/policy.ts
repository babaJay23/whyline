import type { AnnotatedDiff, Flag } from './types.js';
import { FLAG_ORDER } from './resolve/flags.js';
import type { VerifyResult } from './verify.js';

export interface Violation {
  rule: string;
  detail: string;
}

export interface Policy {
  requireRecords?: boolean;
  requireSignature?: boolean;
  maxUntracedRatio?: number;
  forbid?: Flag[];
  subagentNeedsBrief?: boolean;
  allowedSigners?: string[];
}

const BOOLS = ['requireRecords', 'requireSignature', 'subagentNeedsBrief'] as const;

export function parsePolicy(json: string): Policy | string {
  let v: unknown;
  try { v = JSON.parse(json); } catch { return 'policy is not valid JSON'; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'policy must be a JSON object';
  const p: Policy = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if ((BOOLS as readonly string[]).includes(k)) {
      if (typeof val !== 'boolean') return `${k} must be true or false`;
      (p as Record<string, unknown>)[k] = val;
    } else if (k === 'maxUntracedRatio') {
      if (typeof val !== 'number' || val < 0 || val > 1) return 'maxUntracedRatio must be a number between 0 and 1';
      p.maxUntracedRatio = val;
    } else if (k === 'forbid') {
      if (!Array.isArray(val) || !val.every((f) => (FLAG_ORDER as string[]).includes(f as string))) return `forbid must list flags: ${FLAG_ORDER.join(', ')}`;
      p.forbid = val as Flag[];
    } else if (k === 'allowedSigners') {
      if (!Array.isArray(val) || !val.every((s) => typeof s === 'string')) return 'allowedSigners must be a list of strings';
      p.allowedSigners = val as string[];
    } else {
      return `unknown policy key: ${k}`;
    }
  }
  return p;
}

/** `verify` is null for a working-tree review, where there are no commits to have records. */
export function evaluate(d: AnnotatedDiff, verify: VerifyResult[] | null, policy: Policy): Violation[] {
  const out: Violation[] = [];
  const hunks = d.files.flatMap((f) => f.hunks);
  const short = (s: string) => s.slice(0, 7);

  if (policy.requireRecords) {
    if (!verify) out.push({ rule: 'requireRecords', detail: 'no attached records (local diff)' });
    else {
      const bad = verify.filter((r) => !r.attached || r.hash !== 'ok').map((r) => short(r.sha));
      if (bad.length) out.push({ rule: 'requireRecords', detail: `missing or altered: ${bad.join(', ')}` });
    }
  }
  if (policy.requireSignature && verify) {
    const bad = verify.filter((r) => !r.attached || typeof r.signature !== 'object' || r.signature === null).map((r) => short(r.sha));
    if (bad.length) out.push({ rule: 'requireSignature', detail: `unsigned or bad: ${bad.join(', ')}` });
  }
  if (policy.allowedSigners && verify) {
    for (const r of verify) {
      if (r.signature && typeof r.signature === 'object' && !policy.allowedSigners.includes(r.signature.signer)) {
        out.push({ rule: 'allowedSigners', detail: `${r.signature.signer} signed ${short(r.sha)}` });
      }
    }
  }
  if (policy.maxUntracedRatio !== undefined && hunks.length) {
    const untraced = hunks.filter((h) => h.flags.some((x) => x.flag === 'untraced')).length;
    const ratio = untraced / hunks.length;
    if (ratio > policy.maxUntracedRatio) {
      out.push({ rule: 'maxUntracedRatio', detail: `${untraced} of ${hunks.length} hunks untraced (${Math.round(ratio * 100)}%), limit ${Math.round(policy.maxUntracedRatio * 100)}%` });
    }
  }
  for (const flag of policy.forbid ?? []) {
    const n = hunks.filter((h) => h.flags.some((x) => x.flag === flag)).length;
    if (n) out.push({ rule: 'forbid', detail: `${n} ${flag} ${n === 1 ? 'hunk' : 'hunks'}` });
  }
  if (policy.subagentNeedsBrief) {
    const n = hunks.filter((h) => h.flags.some((x) => x.flag === 'subagent') && !h.lead?.agentBrief).length;
    if (n) out.push({ rule: 'subagentNeedsBrief', detail: `${n} subagent ${n === 1 ? 'hunk' : 'hunks'} without a brief` });
  }
  return out;
}
