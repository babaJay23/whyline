import { createHash } from 'node:crypto';
import type { AnnotatedDiff, Provenance } from './types.js';
import { VERSION } from './version.js';

export interface Signature {
  format: 'ssh';
  signer: string;
  namespace: 'whyline';
  sig: string;
}

export interface IntentRecord {
  schemaVersion: 1;
  whyline: string;
  commit: string;
  createdAt: string;
  prompts: boolean;
  record: AnnotatedDiff;
  hash: string;
  signature: Signature | null;
}

type Hashed = Pick<IntentRecord, 'commit' | 'createdAt' | 'prompts' | 'record'>;

export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  }
  return v;
}

export function hashOf(r: Hashed): string {
  const body = canonicalJson({ commit: r.commit, createdAt: r.createdAt, prompts: r.prompts, record: r.record });
  return 'sha256:' + createHash('sha256').update(body, 'utf8').digest('hex');
}

export function buildRecord(commit: string, diff: AnnotatedDiff, opts: { prompts: boolean; now: number }): IntentRecord {
  const record = opts.prompts ? excerpts(forRecord(diff)) : blankPrompts(forRecord(diff));
  const base = { commit, createdAt: new Date(opts.now).toISOString(), prompts: opts.prompts, record };
  return { schemaVersion: 1, whyline: VERSION, ...base, hash: hashOf(base), signature: null };
}

const NOT_RECORDED = 'prompt text not recorded';
const PROMPT_CHARS = 120;
const REASONING_CHARS = 160;
const BRIEF_CHARS = 200;

/** Transcript file paths and working directories mean nothing off this machine and name the user's home. */
function forRecord(diff: AnnotatedDiff): AnnotatedDiff {
  return { ...diff, sessions: diff.sessions.map((s) => ({ ...s, path: '', cwd: '' })) };
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** A record keeps exactly what the renderers show: the first lines of what was asked and said, not the conversation. */
export function excerpts(diff: AnnotatedDiff): AnnotatedDiff {
  const cut = (p: Provenance | null): Provenance | null =>
    p && {
      ...p,
      prompt: { ...p.prompt, text: clip(p.prompt.text, PROMPT_CHARS) },
      reasoning: p.reasoning ? { ...p.reasoning, text: clip(p.reasoning.text, REASONING_CHARS) } : null,
      agentBrief: p.agentBrief === null ? null : clip(p.agentBrief, BRIEF_CHARS),
    };
  return mapProvenance(diff, cut);
}

function mapProvenance(diff: AnnotatedDiff, f: (p: Provenance | null) => Provenance | null): AnnotatedDiff {
  return {
    ...diff,
    files: diff.files.map((file) => ({
      ...file,
      hunks: file.hunks.map((h) => ({ ...h, lead: f(h.lead), lines: h.lines.map((l) => ({ ...l, provenance: f(l.provenance) })) })),
    })),
  };
}

/** Keep structure, cost and flags; drop every excerpt of what a person or agent said. */
export function blankPrompts(diff: AnnotatedDiff): AnnotatedDiff {
  const blank = (p: Provenance | null): Provenance | null =>
    p && { ...p, prompt: { ...p.prompt, text: '' }, reasoning: p.reasoning ? { ...p.reasoning, text: '' } : null, agentBrief: p.agentBrief === null ? null : '' };
  const out = mapProvenance(diff, blank);
  return {
    ...out,
    files: out.files.map((f) => ({
      ...f,
      hunks: f.hunks.map((h) => ({ ...h, flags: h.flags.map((x) => (x.detail.includes('"') ? { ...x, detail: NOT_RECORDED } : x)) })),
    })),
  };
}

export function parseRecord(json: string): IntentRecord | null {
  let v: unknown;
  try { v = JSON.parse(json); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.schemaVersion !== 1 || typeof r.commit !== 'string' || typeof r.hash !== 'string' || !r.record || typeof r.record !== 'object') return null;
  const rec = r.record as Record<string, unknown>;
  if (!Array.isArray(rec.files) || !Array.isArray(rec.sessions) || !rec.totals || typeof rec.totals !== 'object') return null;
  return v as IntentRecord;
}
