import type { AnnotatedLine, EditEvent, Flag, FlagHit, LineTable, Provenance, ShellEvent } from '../types.js';
import type { Turn } from './index.js';

export interface RepoFiles {
  has(path: string): boolean;
  byBasename(name: string): string[];
  read(path: string): string | null;
}

export interface HunkFacts {
  file: string;
  lines: AnnotatedLine[];
  lead: Provenance | null;
  turn: Turn | null;
  table: LineTable;
  fileEdits: EditEvent[];
  shells: ShellEvent[];
  repo: RepoFiles;
  /** Spec references from outside the transcript, e.g. the commit message; they satisfy every hunk. */
  extraSpecRefs: string[];
}

export const FLAG_ORDER: Flag[] = ['untraced', 'unrequested', 'after-correction', 'unspecified', 'drifted', 'churned', 'subagent'];

/** Short words only count when they open the prompt ("No. Use jq."), so "no-cache" and "there's no README" pass. */
export const CORRECTION_WORDS = /^\W*(?:no|stop|undo)(?=[\s,.!:;]|$)|\b(?:don't|do not|revert|wrong|instead|not what i)\b/i;
const CORRECTION_WINDOW = 80;
const CHURN_TURNS = 3;
const CHURN_MIN_CHARS = 8;

export function flagHunk(f: HunkFacts): FlagHit[] {
  const hits: FlagHit[] = [];
  const push = (flag: Flag, detail: string) => hits.push({ flag, detail });

  if (f.lines.some((l) => l.provenance === null) || (f.lines.length === 0 && (f.lead === null || f.lead.tool === 'shell'))) {
    const sh = latestMention(f.file, f.shells);
    push('untraced', sh ? `no structured edit; a shell command touched this file: ${oneLine(sh.command, 70)}` : 'no structured edit covers these lines');
  }

  const promptText = f.turn?.prompt?.text ?? null;
  if (promptText !== null) {
    const named = namedFiles(promptText, f.repo);
    if (named.length && !named.includes(f.file) && !named.some((n) => related(n, f.file, f.repo))) {
      push('unrequested', `prompt named ${named.join(', ')}`);
    }
  }

  if (f.turn) {
    const head = (promptText ?? '').slice(0, CORRECTION_WINDOW);
    if (CORRECTION_WORDS.test(head)) push('after-correction', `prompt begins "${(promptText ?? '').slice(0, 60)}"`);
    else if (f.turn.prevInterrupted) push('after-correction', 'previous turn was interrupted');
  }

  if (f.turn && f.turn.specRefs.length === 0 && !f.turn.specFrom && f.extraSpecRefs.length === 0) {
    push('unspecified', 'no issue, URL or spec document referenced');
  }

  if (f.table.driftedAt !== null && (f.lead === null || f.lead.at > f.table.driftedAt)) {
    push('drifted', `an earlier edit at ${new Date(f.table.driftedAt).toISOString()} did not match the file; attribution after it is best-effort`);
  }

  const needles = new Set(f.lines.map((l) => l.text.trim()).filter((t) => t.length >= CHURN_MIN_CHARS));
  if (needles.size) {
    const turns = new Set<string>();
    for (const e of f.fileEdits) {
      if (changedLines(e).some((l) => needles.has(l))) turns.add(e.turnId);
    }
    if (turns.size >= CHURN_TURNS) push('churned', `rewritten across ${turns.size} turns`);
  }

  if (f.lead && f.lead.agentId !== f.lead.sessionId) {
    push('subagent', f.lead.agentName ?? `subagent ${f.lead.agentId}`);
  }

  return hits.sort((a, b) => FLAG_ORDER.indexOf(a.flag) - FLAG_ORDER.indexOf(b.flag));
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Commands that can change a file: redirects, in-place editors, moves, git operations that rewrite the tree. */
const WRITES = /(^|[\s;&|(])(?:sed\s+-[a-zA-Z]*i|perl\s+-[a-zA-Z]*i|tee|mv|cp|rm|patch|git\s+(?:mv|rm|checkout|restore|apply|stash|revert|reset|merge|rebase|cherry-pick))\b|(?<![0-9&])>{1,2}\s*[^&\s]/;

/** The most recent shell command that named the file and looked like it could write it; the likeliest culprit for an untraced change. */
export function latestMention(file: string, shells: ShellEvent[]): ShellEvent | null {
  const name = basename(file);
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i]!;
    if (!WRITES.test(s.command)) continue;
    if (s.touches.some((t) => file === t || file.endsWith('/' + t) || t.endsWith('/' + file) || t === name)) return s;
  }
  return null;
}

/** Lines an edit actually wrote: context lines carried for uniqueness do not count. */
function changedLines(e: EditEvent): string[] {
  if (e.op.type === 'write') return e.op.content.split('\n').map((l) => l.trim());
  if (e.op.type !== 'replace') return [];
  const before = new Set(e.op.old.split('\n').map((l) => l.trim()));
  return e.op.new.split('\n').map((l) => l.trim()).filter((l) => !before.has(l));
}

/** Repo paths a prompt names, by exact relative path or by basename. */
export function namedFiles(prompt: string, repo: RepoFiles): string[] {
  const out = new Set<string>();
  for (const raw of prompt.split(/[\s,;:()'"`]+/)) {
    const t = raw.replace(/[.?!]+$/, '');
    if (!t || !(t.includes('/') || /\.[a-z0-9]{1,5}$/i.test(t))) continue;
    if (repo.has(t)) { out.add(t); continue; }
    for (const p of repo.byBasename(t)) out.add(p);
  }
  return [...out];
}

const IMPORT = /(?:from|import|require\()\s*['"]([^'"]+)['"]|^\s*(?:from\s+(\S+)\s+import|import\s+([\w.]+))/gm;

/** True when a imports b or b imports a, judged by the last path segment without extension. */
function related(a: string, b: string, repo: RepoFiles): boolean {
  return imports(a, b, repo) || imports(b, a, repo);
}

function imports(from: string, target: string, repo: RepoFiles): boolean {
  const src = repo.read(from);
  if (!src) return false;
  const want = stem(target);
  for (const m of src.matchAll(IMPORT)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? '';
    if (stem(spec.replace(/\./g, '/')) === want || stem(spec) === want) return true;
  }
  return false;
}

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}
function stem(p: string): string {
  return basename(p).replace(/\.[a-z0-9]+$/i, '');
}
