import type { IntentRecord } from '../record.js';
import type { AnnotatedHunk, Usage } from '../types.js';
import { VERSION } from '../version.js';

interface Conversation {
  url?: string;
  contributor: { type: 'ai' | 'unknown'; model_id?: string };
  related?: { type: 'prompt'; url: string }[];
  ranges: { start_line: number; end_line: number }[];
}

export interface AgentTraceRecord {
  version: '0.1';
  id: string;
  timestamp: string;
  vcs: { type: 'git'; revision: string };
  tool: { name: 'whyline'; version: string };
  files: { path: string; conversations: Conversation[] }[];
  metadata: { whyline: { prompts: boolean; cost: Usage; flags: { path: string; start_line: number; end_line: number; flag: string; detail: string }[] } };
}

/** Agent Trace v0.1 (agent-trace.dev): per file, per conversation, line ranges. whyline's own detail rides in metadata. */
export function toAgentTrace(rec: IntentRecord, id: string): AgentTraceRecord {
  const flags: AgentTraceRecord['metadata']['whyline']['flags'] = [];
  const files = rec.record.files.map((f) => {
    const convs = new Map<string, Conversation>();
    for (const h of f.hunks) {
      const r = range(h);
      for (const x of h.flags) flags.push({ path: f.path, start_line: r?.start_line ?? h.newStart, end_line: r?.end_line ?? h.newStart, flag: x.flag, detail: x.detail });
      const p = h.lead;
      const key = p ? `${p.sessionId}\u0000${p.turnId}\u0000${p.agentId}` : '';
      let c = convs.get(key);
      if (!c) {
        if (p) {
          const url = `whyline://${p.harness}/${p.sessionId}/turn/${p.turnNumber}`;
          const model = modelId(p.turnModel);
          c = { url, contributor: model ? { type: 'ai', model_id: model } : { type: 'ai' }, related: [{ type: 'prompt', url: `${url}#prompt` }], ranges: [] };
        } else {
          c = { contributor: { type: 'unknown' }, ranges: [] };
        }
        convs.set(key, c);
      }
      if (r) c.ranges.push(r);
    }
    return { path: f.path, conversations: [...convs.values()] };
  });
  return {
    version: '0.1',
    id,
    timestamp: rec.createdAt,
    vcs: { type: 'git', revision: rec.commit },
    tool: { name: 'whyline', version: VERSION },
    files,
    metadata: { whyline: { prompts: rec.prompts, cost: rec.record.totals.cost, flags } },
  };
}

function range(h: AnnotatedHunk): { start_line: number; end_line: number } | null {
  return h.newLines === 0 ? null : { start_line: h.newStart, end_line: h.newStart + h.newLines - 1 };
}

/** models.dev convention: provider/model. Only providers whose ids are recognisable by prefix. */
function modelId(model: string | null): string | null {
  if (!model) return null;
  if (model.startsWith('claude-')) return `anthropic/${model}`;
  if (model.startsWith('gpt-') || /^o\d/.test(model)) return `openai/${model}`;
  return null;
}
