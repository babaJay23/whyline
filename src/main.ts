import { parseArgs } from 'node:util';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters } from './adapters/index.js';
import { commitTime, diffText, gitDir, hasCommits, lsFiles, mergeBase, noteShow, parents, parseRange, pushNotes, readWorkingFile, repoRoot, revList, show, untracked } from './git.js';
import { mergeRecords, readRecords } from './merge.js';
import { attachCommits, recordFor } from './attach.js';
import { toAgentTrace } from './export/agent-trace.js';
import { parseRecord } from './record.js';
import { allGood, describeResult, verifyCommits } from './verify.js';
import { randomUUID } from 'node:crypto';
import { renderHtml } from './render/html.js';
import { renderJson } from './render/json.js';
import { renderTerminal, verdict } from './render/terminal.js';
import { colorEnabled } from './render/ansi.js';
import { parseUnifiedDiff, syntheticAdded } from './resolve/diff.js';
import { resolve } from './resolve/resolve.js';
import type { RepoFiles } from './resolve/flags.js';
import { findSessions } from './sessions.js';
import { PRICES, isPriceTable, mergePrices, type PriceTable } from './pricing.js';
import type { AnnotatedDiff, SessionRef, Window } from './types.js';

export interface Io {
  cwd: string;
  home: string;
  env: NodeJS.ProcessEnv;
  stdout: { write(s: string): unknown; isTTY?: boolean };
  stderr: { write(s: string): unknown };
  now(): number;
}

const USAGE = `whyline [range] [options]        annotate the diff (default: working tree vs HEAD)
whyline sessions                 list agent sessions found for this repo
whyline doctor                   show what whyline can and cannot see here
whyline attach [range]           write an intent record for each commit into git notes (default: HEAD)
  --no-prompts     leave prompt and reasoning text out of the record
  --push           push refs/notes/whyline to --remote (default origin) afterwards
  --quiet          print only failures (for hooks)
whyline export [range] --format agent-trace   print one Agent Trace record per commit (JSON lines)
whyline verify [range]           check attached records: present, unaltered, signed

options
  --all            show unflagged hunks too
  --brief          headers and flags only, no diff bodies (cheap for an agent to read)
  --prices <file>  estimate dollars from a JSON price table; "default" uses the built-in list prices
  --json           print the full result as JSON
  --html <file>    write a self-contained HTML report
  --since <when>   only sessions after an ISO date or Nd (e.g. 7d)
  --session <id>   use only this session (repeatable, prefix ok)
  --no-color       disable colors (NO_COLOR is also honored)
  --from-notes     read attached records instead of local transcripts
  --no-notes       never fall back to attached records
`;

export async function run(argv: string[], io: Io): Promise<number> {
  let args: ReturnType<typeof parseOptions>;
  try {
    args = parseOptions(argv);
  } catch (e) {
    io.stderr.write(`${(e as Error).message}\n\n${USAGE}`);
    return 1;
  }
  if (args.values.help) { io.stdout.write(USAGE); return 0; }

  const root = repoRoot(io.cwd);
  if (!root) { io.stderr.write('whyline: not a git repository\n'); return 2; }

  const cmd = args.positionals[0];
  if (cmd === 'sessions') return sessions(root, io);
  if (cmd === 'doctor') return doctor(root, io);
  if (cmd === 'attach') return attach(root, args.positionals[1] ?? 'HEAD', args.values, io);
  if (cmd === 'export') return exportCmd(root, args.positionals[1] ?? 'HEAD', args.values, io);
  if (cmd === 'verify') return verifyCmd(root, args.positionals[1] ?? 'HEAD', io);
  return review(root, cmd ?? null, args.values, io);
}

function parseOptions(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      brief: { type: 'boolean', default: false },
      prices: { type: 'string' },
      json: { type: 'boolean', default: false },
      html: { type: 'string' },
      since: { type: 'string' },
      session: { type: 'string', multiple: true },
      'no-color': { type: 'boolean', default: false },
      'no-prompts': { type: 'boolean', default: false },
      'from-notes': { type: 'boolean', default: false },
      'no-notes': { type: 'boolean', default: false },
      push: { type: 'boolean', default: false },
      remote: { type: 'string', default: 'origin' },
      quiet: { type: 'boolean', default: false },
      format: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
}

type Values = ReturnType<typeof parseOptions>['values'];

interface Gathered {
  result: AnnotatedDiff;
  banner: string | null;
  /** The commits a range names, or null for a working-tree review. */
  shas: string[] | null;
}

/** Everything a review needs, from local transcripts or, failing that, from attached records. Returns an exit code on failure. */
async function gather(root: string, range: string | null, v: Values, io: Io): Promise<Gathered | number> {
  if (!hasCommits(root)) { io.stderr.write('whyline: this repository has no commits yet\n'); return 1; }
  const { base, head } = parseRange(range);
  let window: Window;
  try {
    // For two refs the branch's work began at their merge base, not at wherever base points today.
    const from = head ? mergeBase(root, base, head) ?? base : base;
    window = { from: commitTime(root, from), to: head ? commitTime(root, head) : io.now() };
  } catch {
    io.stderr.write(`whyline: unknown revision in "${range}"\n`);
    return 1;
  }
  if (v.since) {
    const since = parseSince(v.since, io.now());
    if (since === null) { io.stderr.write(`whyline: cannot parse --since ${v.since}\n`); return 1; }
    window.from = since;
  }
  let prices: PriceTable | undefined;
  if (v.prices) {
    const loaded = loadPrices(v.prices);
    if (typeof loaded === 'string') { io.stderr.write(`whyline: cannot read prices ${v.prices}: ${loaded}\n`); return 1; }
    prices = loaded;
  }

  const diffs = parseUnifiedDiff(diffText(root, range));
  const untrackedFiles = head ? [] : untracked(root);
  for (const p of untrackedFiles) {
    const content = readWorkingFile(root, p);
    if (content !== null && !looksBinary(content)) diffs.push(syntheticAdded(p, content));
  }
  if (diffs.length === 0) { io.stdout.write('no changes\n'); return 2; }

  const shas = head ? revList(root, `${base}..${head}`).filter((s) => parents(root, s).length <= 1) : null;
  const ids = v.session && v.session.length ? v.session : undefined;
  const live = await findSessions(root, io.home, ids ? { window, ids } : { window });

  // An explicit --session that matches nothing is a question about sessions, not a request for records.
  if (shas && !v['no-notes'] && (v['from-notes'] || (live.selected.length === 0 && !ids))) {
    const { records, missing, invalid } = readRecords(root, shas);
    for (const s of missing) io.stderr.write(`whyline: missing record for ${s.slice(0, 7)}\n`);
    for (const s of invalid) io.stderr.write(`whyline: unreadable record for ${s.slice(0, 7)}\n`);
    if (records.length && !missing.length && !invalid.length) {
      const n = records.length;
      return { result: mergeRecords(records, range ?? '', io.now()), banner: `from attached records (${n} ${n === 1 ? 'commit' : 'commits'})`, shas };
    }
    if (live.selected.length === 0) {
      io.stderr.write('run `whyline attach <range>` on the machine that has the transcripts\n');
      return 3;
    }
  }
  if (live.selected.length === 0) {
    io.stderr.write(noSessions(live.all, io.home, window));
    return 3;
  }

  const tracked = new Set([...lsFiles(root), ...untrackedFiles]);
  const repo: RepoFiles = {
    has: (p) => tracked.has(p),
    byBasename: (n) => [...tracked].filter((p) => p.split('/').pop() === n),
    read: (p) => readWorkingFile(root, p),
  };
  const result = resolve({
    repoRoot: root,
    range: range ?? 'HEAD..working tree',
    window,
    diffs,
    sessions: live.selected,
    baseText: (p) => show(root, base, p),
    headText: (p) => (head ? show(root, head, p) : readWorkingFile(root, p)),
    repo,
    now: io.now(),
    ...(prices ? { prices } : {}),
  });
  return { result, banner: null, shas };
}

async function review(root: string, range: string | null, v: Values, io: Io): Promise<number> {
  const g = await gather(root, range, v, io);
  if (typeof g === 'number') return g;
  const { result, banner } = g;
  const extra = banner ? { banner } : {};

  if (v.html) {
    try {
      writeFileSync(v.html, renderHtml(result, extra));
    } catch (e) {
      io.stderr.write(`whyline: cannot write ${v.html}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}\n`);
      return 1;
    }
  }
  if (v.json) { io.stdout.write(renderJson(result)); return 0; }
  if (v.html) { io.stdout.write(`${verdict(result)}\nwrote ${v.html}\n`); return 0; }
  io.stdout.write(renderTerminal(result, { color: colorEnabled(v['no-color'], io.stdout, io.env), all: v.all, brief: v.brief, ...extra }));
  return 0;
}

async function attach(root: string, range: string, v: Values, io: Io): Promise<number> {
  const shas = revList(root, range);
  if (shas.length === 0) { io.stderr.write(`whyline: unknown revision "${range}"\n`); return 1; }
  let prices: PriceTable | undefined;
  if (v.prices) {
    const loaded = loadPrices(v.prices);
    if (typeof loaded === 'string') { io.stderr.write(`whyline: cannot read prices ${v.prices}: ${loaded}\n`); return 1; }
    prices = loaded;
  }
  const results = await attachCommits(root, shas, { prompts: !v['no-prompts'], now: io.now(), home: io.home, ...(prices ? { prices } : {}) });
  let attached = 0;
  const failures: string[] = [];
  for (const res of results) {
    const short = res.sha.slice(0, 7);
    if (res.status === 'attached') {
      attached++;
      const hunks = res.record.record.totals.hunks;
      const flagged = res.record.record.files.flatMap((f) => f.hunks).filter((h) => h.flags.length).length;
      if (!v.quiet) io.stdout.write(`${short}  attached (${hunks} ${hunks === 1 ? 'hunk' : 'hunks'}, ${flagged} flagged)\n`);
    } else {
      const why = res.status === 'skipped-merge' ? 'skipped (merge commit)' : res.status === 'no-sessions' ? 'no sessions' : 'write failed';
      failures.push(`${short}  ${why}`);
      (v.quiet ? io.stderr : io.stdout).write(`${short}  ${why}\n`);
    }
  }
  if (attached === 0) {
    if (v.quiet) writeLastError(root, failures.join('; ') || 'nothing to attach');
    return 3;
  }
  if (v.push) {
    const err = pushNotes(root, v.remote);
    if (err) { io.stderr.write(`whyline: push failed: ${err}\n`); return 1; }
    if (!v.quiet) io.stdout.write(`pushed refs/notes/whyline to ${v.remote}\n`);
  }
  return 0;
}

async function exportCmd(root: string, range: string, v: Values, io: Io): Promise<number> {
  if (v.format !== 'agent-trace') { io.stderr.write(`whyline: --format must be agent-trace\n\n${USAGE}`); return 1; }
  const shas = revList(root, range).filter((s) => parents(root, s).length <= 1);
  if (shas.length === 0) { io.stderr.write(`whyline: unknown revision "${range}"\n`); return 1; }
  let missing = 0;
  for (const sha of shas) {
    const text = noteShow(root, sha);
    let rec = text ? parseRecord(text) : null;
    if (!rec && !v['from-notes']) rec = await recordFor(root, sha, { prompts: !v['no-prompts'], now: io.now(), home: io.home });
    if (!rec) { io.stderr.write(`whyline: no record or transcript for ${sha.slice(0, 7)}\n`); missing++; continue; }
    io.stdout.write(JSON.stringify(toAgentTrace(rec, randomUUID())) + '\n');
  }
  return missing ? 3 : 0;
}

async function verifyCmd(root: string, range: string, io: Io): Promise<number> {
  const shas = revList(root, range).filter((s) => parents(root, s).length <= 1);
  if (shas.length === 0) { io.stderr.write(`whyline: unknown revision "${range}"\n`); return 1; }
  const results = verifyCommits(root, shas);
  io.stdout.write(results.map(describeResult).join('\n') + '\n');
  return allGood(results) ? 0 : 3;
}

/** "default" is the built-in table; a file path is merged over it. Returns an error string on failure. */
function loadPrices(spec: string): PriceTable | string {
  if (spec === 'default') return PRICES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(spec, 'utf8'));
  } catch (e) {
    return (e as NodeJS.ErrnoException).code ?? (e as Error).message;
  }
  if (!isPriceTable(parsed)) return 'expected {"<model>": {"input","output","cacheRead","cacheWrite"}} in USD per million tokens';
  return mergePrices(PRICES, parsed);
}

function writeLastError(root: string, text: string): void {
  try { writeFileSync(join(gitDir(root), 'whyline-last-error'), `${new Date().toISOString()} ${text}\n`); } catch { /* best effort; doctor reports what it can */ }
}

async function sessions(root: string, io: Io): Promise<number> {
  const { all } = await findSessions(root, io.home, { all: true });
  if (all.length === 0) { io.stderr.write(noSessions(all, io.home, null)); return 3; }
  io.stdout.write(all.map(line).join('\n') + '\n');
  return 0;
}

async function doctor(root: string, io: Io): Promise<number> {
  const out: string[] = [`repo: ${root}`];
  for (const dir of [join(io.home, '.claude', 'projects'), join(io.home, '.codex', 'sessions')]) {
    out.push(`${dir}: ${existsSync(dir) ? 'found' : 'missing'}`);
  }
  const { selected } = await findSessions(root, io.home, { all: true });
  for (const a of adapters) {
    const mine = selected.filter((s) => s.ref.harness === a.harness);
    const skipped = mine.reduce((n, s) => n + s.skipped, 0);
    const edits = mine.reduce((n, s) => n + s.events.filter((e) => e.kind === 'edit').length, 0);
    const shells = mine.reduce((n, s) => n + s.events.filter((e) => e.kind === 'shell').length, 0);
    out.push(`${a.harness}: ${mine.length} ${mine.length === 1 ? 'session' : 'sessions'}, ${edits} structured edits, ${shells} shell commands, ${skipped} unreadable lines`);
  }
  out.push('', 'known gap: edits made through shell commands (sed, heredocs, scripts) have no structured record and show as untraced.');
  io.stdout.write(out.join('\n') + '\n');
  return 0;
}

function line(r: SessionRef): string {
  const mins = Math.max(1, Math.round((r.endedAt - r.startedAt) / 60_000));
  return `${r.harness.padEnd(12)} ${r.id.slice(0, 12).padEnd(13)} ${new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' ')}  ${mins}m  ${r.cwd}`;
}

function noSessions(all: SessionRef[], home: string, window: Window | null): string {
  if (all.length === 0) {
    return `whyline: no agent sessions found for this repo\nlooked in ${join(home, '.claude/projects')} and ${join(home, '.codex/sessions')}\n`;
  }
  const span = window ? ` between ${new Date(window.from).toISOString()} and ${new Date(window.to).toISOString()}` : '';
  return `whyline: no matching sessions${span}; found these for this repo:\n${all.map(line).join('\n')}\nuse --since or --session to pick one\n`;
}

/** Git's own heuristic: a NUL byte in the first 8 KB means binary. */
function looksBinary(content: string): boolean {
  return content.slice(0, 8192).includes('\u0000');
}

function parseSince(s: string, now: number): number | null {
  const m = /^(\d+)d$/.exec(s);
  if (m) return now - Number(m[1]) * 86_400_000;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}
