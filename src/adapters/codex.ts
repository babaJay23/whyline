import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, Event, SessionRef } from '../types.js';
import { parseApplyPatch } from './apply-patch.js';
import { readJsonl, firstLine, obj, str, num } from './jsonl.js';
import { pathTokens } from './claude-code.js';

function real(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}
function inside(root: string, cwd: string): boolean {
  const r = real(root), c = real(cwd);
  return c === r || c.startsWith(r.endsWith('/') ? r : r + '/');
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) yield p;
  }
}

export const codex: Adapter = {
  harness: 'codex',

  async discover(repoRoot, home) {
    const root = join(home, '.codex', 'sessions');
    if (!existsSync(root)) return [];
    const refs: SessionRef[] = [];
    for (const path of walk(root)) {
      const head = obj(firstLine(path));
      const payload = head ? obj(head.payload) : null;
      if (!head || !payload || head.type !== 'session_meta') continue;
      const cwd = str(payload.cwd);
      if (!cwd || !inside(repoRoot, cwd)) continue;
      const startedAt = Date.parse(str(payload.timestamp) ?? str(head.timestamp) ?? '');
      if (Number.isNaN(startedAt)) continue;
      const endedAt = lastTimestamp(path) ?? statSync(path).mtimeMs;
      refs.push({ harness: 'codex', id: str(payload.id) ?? str(payload.session_id) ?? path, path, cwd, startedAt, endedAt });
    }
    return refs.sort((a, b) => a.startedAt - b.startedAt);
  },

  async read(ref) {
    const { rows, skipped } = readJsonl(ref.path);
    const events: Event[] = [];
    const sessionId = ref.id;
    let turnId = 'turn-0';
    let n = 0;

    for (const r of rows) {
      const o = obj(r); if (!o) continue;
      const at = Date.parse(str(o.timestamp) ?? '');
      if (Number.isNaN(at)) continue;
      const p = obj(o.payload); if (!p) continue;
      const type = str(o.type);
      const pt = str(p.type);
      const base = { sessionId, agentId: sessionId, turnId, at };

      if (type === 'turn_context') { turnId = str(p.turn_id) ?? `turn-${++n}`; continue; }

      if (type === 'event_msg') {
        if (pt === 'user_message' && str(p.message)) {
          events.push({ kind: 'prompt', id: `${turnId}:prompt:${++n}`, ...base, text: p.message as string });
        } else if (pt === 'agent_message' && str(p.message)) {
          events.push({ kind: 'reasoning', id: `${turnId}:msg:${++n}`, ...base, text: p.message as string, visible: true });
        } else if (pt === 'token_count') {
          const last = obj(obj(p.info)?.last_token_usage);
          if (last) {
            const cached = num(last.cached_input_tokens);
            events.push({
              kind: 'usage', id: `${turnId}:usage:${++n}`, ...base,
              input: Math.max(0, num(last.input_tokens) - cached), output: num(last.output_tokens),
              cacheRead: cached, cacheWrite: num(last.cache_write_input_tokens),
            });
          }
        } else if (pt === 'turn_aborted' && p.reason === 'interrupted') {
          const tid = str(p.turn_id) ?? turnId;
          events.push({ kind: 'interrupt', id: `${tid}:interrupt`, ...base, turnId: tid });
        }
        continue;
      }

      if (type !== 'response_item') continue;
      if (pt === 'reasoning' && Array.isArray(p.summary)) {
        const text = p.summary.map((s) => str(obj(s)?.text) ?? '').filter(Boolean).join('\n');
        if (text) events.push({ kind: 'reasoning', id: str(p.id) ?? `${turnId}:rs:${++n}`, ...base, text, visible: false });
      } else if (pt === 'function_call') {
        const callId = str(p.call_id) ?? str(p.id) ?? `${turnId}:fc:${++n}`;
        const command = shellCommand(str(p.name), str(p.arguments));
        if (!command) continue;
        // Codex sometimes delivers apply_patch through a shell heredoc; the patch text is still structured.
        const patchAt = command.indexOf('*** Begin Patch');
        const patched = patchAt === -1 ? [] : parseApplyPatch(command.slice(patchAt));
        if (patched.length) {
          for (const { file, op } of patched) events.push({ kind: 'edit', id: callId, ...base, tool: 'apply_patch', file, op });
        } else {
          events.push({ kind: 'shell', id: callId, ...base, command, touches: pathTokens(command) });
        }
      } else if (pt === 'custom_tool_call' && p.name === 'apply_patch' && str(p.input)) {
        const callId = str(p.call_id) ?? str(p.id) ?? `${turnId}:patch:${++n}`;
        for (const { file, op } of parseApplyPatch(p.input as string)) {
          events.push({ kind: 'edit', id: callId, ...base, tool: 'apply_patch', file, op });
        }
      }
    }
    events.sort((a, b) => a.at - b.at);
    return { events, skipped };
  },
};

function lastTimestamp(path: string): number | null {
  let last: number | null = null;
  for (const r of readJsonl(path).rows) {
    const t = Date.parse(str(obj(r)?.timestamp) ?? '');
    if (!Number.isNaN(t)) last = t;
  }
  return last;
}

function shellCommand(name: string | null, args: string | null): string | null {
  if (!args || (name !== 'exec_command' && name !== 'shell' && name !== 'shell_command')) return null;
  let parsed: Record<string, unknown> | null;
  try { parsed = obj(JSON.parse(args)); } catch { return null; }
  if (!parsed) return null;
  const cmd = parsed.cmd ?? parsed.command;
  if (typeof cmd === 'string') return cmd;
  if (Array.isArray(cmd)) return cmd.filter((x): x is string => typeof x === 'string').join(' ');
  return null;
}
