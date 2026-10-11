import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Adapter, EditOp, Event, SessionRef } from '../types.js';
import { readJsonl, obj, str, num } from './jsonl.js';

export function slug(absPath: string): string {
  return absPath.replace(/[\\/]/g, '-');
}

function real(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

function inside(root: string, cwd: string): boolean {
  const r = real(root), c = real(cwd);
  return c === r || c.startsWith(r.endsWith('/') ? r : r + '/');
}

export const claudeCode: Adapter = {
  harness: 'claude-code',

  async discover(repoRoot, home) {
    const projects = join(home, '.claude', 'projects');
    if (!existsSync(projects)) return [];
    const prefix = slug(real(repoRoot));
    const refs: SessionRef[] = [];
    for (const dir of readdirSync(projects)) {
      if (!dir.startsWith(prefix)) continue; // sessions run in subdirectories share the prefix
      const dirPath = join(projects, dir);
      for (const f of readdirSync(dirPath)) {
        if (!f.endsWith('.jsonl')) continue;
        const path = join(dirPath, f);
        const { rows } = readJsonl(path);
        const meta = sessionMeta(rows);
        if (!meta || !inside(repoRoot, meta.cwd)) continue;
        refs.push({ harness: 'claude-code', id: meta.id ?? basename(f, '.jsonl'), path, cwd: meta.cwd, startedAt: meta.start, endedAt: meta.end });
      }
    }
    return refs.sort((a, b) => a.startedAt - b.startedAt);
  },

  async read(ref) {
    const main = readJsonl(ref.path);
    const events = parseRows(main.rows, ref.id, null);
    let skipped = main.skipped;
    const subDir = join(ref.path.replace(/\.jsonl$/, ''), 'subagents');
    if (existsSync(subDir)) {
      for (const f of readdirSync(subDir)) {
        const m = /^agent-(.+)\.jsonl$/.exec(f);
        if (!m) continue;
        const sub = readJsonl(join(subDir, f));
        skipped += sub.skipped;
        events.push(...parseRows(sub.rows, ref.id, m[1]!));
      }
    }
    events.sort((a, b) => a.at - b.at);
    return { events, skipped };
  },
};

function sessionMeta(rows: unknown[]): { id: string | null; cwd: string; start: number; end: number } | null {
  let cwd: string | null = null, id: string | null = null, start = Infinity, end = -Infinity;
  for (const r of rows) {
    const o = obj(r); if (!o) continue;
    cwd ??= str(o.cwd); id ??= str(o.sessionId);
    const t = ts(o); if (t !== null) { start = Math.min(start, t); end = Math.max(end, t); }
  }
  if (!cwd || start === Infinity) return null;
  return { id, cwd, start, end };
}

function ts(o: Record<string, unknown>): number | null {
  const s = str(o.timestamp);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : t;
}

/** agentId === null means the main transcript; otherwise rows belong to that subagent. */
function parseRows(rows: unknown[], sessionId: string, agentId: string | null): Event[] {
  const events: Event[] = [];
  const agent = agentId ?? sessionId;
  let turnId = 'turn-0';
  const seenRequests = new Set<string>();
  const pendingSpawns = new Map<string, { name: string; brief: string }>();

  for (const r of rows) {
    const o = obj(r); if (!o) continue;
    const at = ts(o); if (at === null) continue;
    const msg = obj(o.message);
    const type = str(o.type);

    if (type === 'user') {
      if (agentId !== null) { turnId = str(o.promptId) ?? turnId; }
      const result = obj(o.toolUseResult);
      if (result) {
        const childAgentId = str(result.agentId);
        const callId = toolResultId(msg);
        const spawn = callId ? pendingSpawns.get(callId) : undefined;
        if (childAgentId && spawn && callId) {
          events.push({ kind: 'spawn', id: `${callId}:spawn`, sessionId, agentId: agent, turnId, at, childAgentId, ...spawn });
          pendingSpawns.delete(callId);
        }
        continue;
      }
      if (o.isMeta === true || agentId !== null) continue;
      const text = humanText(msg);
      if (text === null) continue;
      turnId = str(o.promptId) ?? str(o.uuid) ?? turnId;
      if (text.includes('[Request interrupted by user')) {
        events.push({ kind: 'interrupt', id: `${turnId}:interrupt`, sessionId, agentId: agent, turnId, at });
      } else {
        events.push({ kind: 'prompt', id: str(o.uuid) ?? `${turnId}:prompt`, sessionId, agentId: agent, turnId, at, text });
      }
      continue;
    }

    if (type !== 'assistant' || !msg) continue;
    if (agentId !== null) turnId = str(o.promptId) ?? turnId;
    const rid = str(o.requestId);
    const usage = obj(msg.usage);
    if (usage && rid && !seenRequests.has(rid)) {
      seenRequests.add(rid);
      events.push({
        kind: 'usage', id: `${rid}:usage`, sessionId, agentId: agent, turnId, at,
        input: num(usage.input_tokens), output: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_input_tokens), cacheWrite: num(usage.cache_creation_input_tokens),
      });
    }
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      const b = obj(block); if (!b) continue;
      const bt = str(b.type);
      if (bt === 'text' && str(b.text)) {
        events.push({ kind: 'reasoning', id: `${str(o.uuid)}:text`, sessionId, agentId: agent, turnId, at, text: b.text as string, visible: true });
      } else if (bt === 'thinking' && str(b.thinking)) {
        events.push({ kind: 'reasoning', id: `${str(o.uuid)}:thinking`, sessionId, agentId: agent, turnId, at, text: b.thinking as string, visible: false });
      } else if (bt === 'tool_use') {
        const id = str(b.id) ?? `${str(o.uuid)}:tool`;
        const name = str(b.name) ?? '';
        const input = obj(b.input);
        if (!input) continue;
        for (const op of editOps(name, input)) {
          events.push({ kind: 'edit', id, sessionId, agentId: agent, turnId, at, tool: name, file: op.file, op: op.op });
        }
        if (name === 'Bash' && str(input.command)) {
          const command = input.command as string;
          events.push({ kind: 'shell', id, sessionId, agentId: agent, turnId, at, command, touches: pathTokens(command) });
        }
        if (name === 'Agent') {
          pendingSpawns.set(id, { name: str(input.subagent_type) ?? 'agent', brief: str(input.description) ?? str(input.prompt) ?? '' });
        }
      }
    }
  }
  return events;
}

function humanText(msg: Record<string, unknown> | null): string | null {
  if (!msg) return null;
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return null;
  const parts: string[] = [];
  for (const block of c) {
    const b = obj(block);
    if (!b) continue;
    if (b.type === 'tool_result') return null;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.length ? parts.join('\n') : null;
}

function toolResultId(msg: Record<string, unknown> | null): string | null {
  if (!msg || !Array.isArray(msg.content)) return null;
  for (const block of msg.content) {
    const b = obj(block);
    if (b && b.type === 'tool_result' && typeof b.tool_use_id === 'string') return b.tool_use_id;
  }
  return null;
}

function editOps(name: string, input: Record<string, unknown>): { file: string; op: EditOp }[] {
  const file = str(input.file_path);
  if (!file) return [];
  if (name === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return [{ file, op: { type: 'replace', old: input.old_string, new: input.new_string, all: input.replace_all === true } }];
  }
  if (name === 'Write' && typeof input.content === 'string') {
    return [{ file, op: { type: 'write', content: input.content } }];
  }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    const out: { file: string; op: EditOp }[] = [];
    for (const e of input.edits) {
      const x = obj(e);
      if (x && typeof x.old_string === 'string' && typeof x.new_string === 'string') {
        out.push({ file, op: { type: 'replace', old: x.old_string, new: x.new_string, all: x.replace_all === true } });
      }
    }
    return out;
  }
  return [];
}

/** Tokens that look like file paths: contain a slash or end in a short extension. Best effort, used only for hints. */
export function pathTokens(command: string): string[] {
  const out = new Set<string>();
  for (const raw of command.split(/[\s'"`;|&()<>]+/)) {
    const t = raw.replace(/^[-=]+/, '');
    if (!t || t.startsWith('http')) continue;
    if (t.includes('/') || /\.[a-z0-9]{1,5}$/i.test(t)) {
      if (/^[\w./~-]+$/.test(t) && t !== '.' && t !== '..') out.add(t);
    }
  }
  return [...out];
}
