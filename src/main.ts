import { parseArgs } from 'node:util';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { adapters } from './adapters/index.js';
import { commitTime, diffText, lsFiles, mergeBase, parseRange, readWorkingFile, repoRoot, show, untracked } from './git.js';
import { renderHtml } from './render/html.js';
import { renderJson } from './render/json.js';
import { renderTerminal, verdict } from './render/terminal.js';
import { colorEnabled } from './render/ansi.js';
import { parseUnifiedDiff, syntheticAdded } from './resolve/diff.js';
import { resolve } from './resolve/resolve.js';
import type { RepoFiles } from './resolve/flags.js';
import { findSessions } from './sessions.js';
import type { SessionRef, Window } from './types.js';

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

options
  --all            show unflagged hunks too
  --json           print the full result as JSON
  --html <file>    write a self-contained HTML report
  --since <when>   only sessions after an ISO date or Nd (e.g. 7d)
  --session <id>   use only this session (repeatable, prefix ok)
  --no-color       disable colors (NO_COLOR is also honored)
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
  return review(root, cmd ?? null, args.values, io);
}

function parseOptions(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      html: { type: 'string' },
      since: { type: 'string' },
      session: { type: 'string', multiple: true },
      'no-color': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
}

type Values = ReturnType<typeof parseOptions>['values'];

async function review(root: string, range: string | null, v: Values, io: Io): Promise<number> {
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

  const diffs = parseUnifiedDiff(diffText(root, range));
  if (!head) {
    for (const p of untracked(root)) {
      const content = readWorkingFile(root, p);
      if (content !== null && !looksBinary(content)) diffs.push(syntheticAdded(p, content));
    }
  }
  if (diffs.length === 0) { io.stdout.write('no changes\n'); return 2; }

  const ids = v.session && v.session.length ? v.session : undefined;
  const { selected, all } = await findSessions(root, io.home, ids ? { window, ids } : { window });
  if (selected.length === 0) {
    io.stderr.write(noSessions(all, io.home, window));
    return 3;
  }

  const tracked = new Set([...lsFiles(root), ...untracked(root)]);
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
    sessions: selected,
    baseText: (p) => show(root, base, p),
    headText: (p) => (head ? show(root, head, p) : readWorkingFile(root, p)),
    repo,
  });

  if (v.json) { io.stdout.write(renderJson(result)); return 0; }
  if (v.html) {
    writeFileSync(v.html, renderHtml(result));
    io.stdout.write(`${verdict(result)}\nwrote ${v.html}\n`);
    return 0;
  }
  io.stdout.write(renderTerminal(result, { color: colorEnabled(v['no-color'], io.stdout, io.env), all: v.all }));
  return 0;
}

async function sessions(root: string, io: Io): Promise<number> {
  const { all } = await findSessions(root, io.home, { window: { from: 0, to: Number.MAX_SAFE_INTEGER }, ids: [''] });
  if (all.length === 0) { io.stderr.write(noSessions(all, io.home, null)); return 3; }
  io.stdout.write(all.map(line).join('\n') + '\n');
  return 0;
}

async function doctor(root: string, io: Io): Promise<number> {
  const out: string[] = [`repo: ${root}`];
  for (const dir of [join(io.home, '.claude', 'projects'), join(io.home, '.codex', 'sessions')]) {
    out.push(`${dir}: ${existsSync(dir) ? 'found' : 'missing'}`);
  }
  const { selected } = await findSessions(root, io.home, { window: { from: 0, to: Number.MAX_SAFE_INTEGER }, ids: [''] });
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
