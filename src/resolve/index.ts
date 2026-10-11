import type { EditEvent, Harness, PromptEvent, ReasoningEvent, Session, ShellEvent, Usage, Window } from '../types.js';
import { ZERO_USAGE, addUsage } from '../types.js';

export interface Turn {
  id: string;
  sessionId: string;
  harness: Harness;
  prompt: PromptEvent | null;
  reasoning: ReasoningEvent[];
  usage: Usage | null;
  interrupted: boolean;
  prevInterrupted: boolean;
  firstAt: number;
  number: number; // 1-based within the session, by time
  model: string | null; // the model behind most of the turn's tokens
}

export interface EventIndex {
  turns: Map<string, Turn>;
  editsByFile: Map<string, EditEvent[]>;
  shells: ShellEvent[];
  agents: Map<string, { name: string; brief: string }>;
  harnessOf: Map<string, Harness>;
}

/** Turn ids are only unique within a session; both adapters even share the default 'turn-0'. */
export function turnKey(sessionId: string, turnId: string): string {
  return `${sessionId}\u0000${turnId}`;
}

export function relPath(repoRoot: string, abs: string): string | null {
  const root = repoRoot.replace(/[\\/]+$/, '');
  const a = abs.replace(/\\/g, '/');
  if (a === root) return null;
  if (!a.startsWith(root + '/')) return null;
  return a.slice(root.length + 1);
}

export function selectEdits(edits: EditEvent[], window: Window): EditEvent[] {
  return edits.filter((e) => e.at > window.from && e.at <= window.to);
}

export function indexEvents(sessions: Session[], repoRoot: string): EventIndex {
  const turns = new Map<string, Turn>();
  const editsByFile = new Map<string, EditEvent[]>();
  const shells: ShellEvent[] = [];
  const agents = new Map<string, { name: string; brief: string }>();
  const harnessOf = new Map<string, Harness>();
  const modelTokens = new Map<string, Map<string, number>>(); // turn key -> model -> tokens

  for (const { ref, events } of sessions) {
    harnessOf.set(ref.id, ref.harness);
    const turn = (id: string, at: number): Turn => {
      const key = turnKey(ref.id, id);
      let t = turns.get(key);
      if (!t) {
        t = { id, sessionId: ref.id, harness: ref.harness, prompt: null, reasoning: [], usage: null, interrupted: false, prevInterrupted: false, firstAt: at, number: 0, model: null };
        turns.set(key, t);
      }
      if (at < t.firstAt) t.firstAt = at;
      return t;
    };
    for (const e of events) {
      const t = turn(e.turnId, e.at);
      switch (e.kind) {
        case 'prompt': t.prompt ??= e; break;
        case 'reasoning': t.reasoning.push(e); break;
        case 'usage': {
          t.usage = addUsage(t.usage ?? ZERO_USAGE, e);
          if (e.model) {
            const key = turnKey(ref.id, e.turnId);
            const m = modelTokens.get(key) ?? new Map<string, number>();
            m.set(e.model, (m.get(e.model) ?? 0) + e.input + e.output + e.cacheRead + e.cacheWrite);
            modelTokens.set(key, m);
          }
          break;
        }
        case 'interrupt': t.interrupted = true; break;
        case 'spawn': agents.set(e.childAgentId, { name: e.name, brief: e.brief }); break;
        case 'shell': shells.push(e); break;
        case 'edit': {
          const rel = relPath(repoRoot, e.file);
          if (!rel) break;
          const list = editsByFile.get(rel) ?? [];
          list.push(e);
          editsByFile.set(rel, list);
        }
      }
    }
  }
  for (const list of editsByFile.values()) list.sort((a, b) => a.at - b.at);
  for (const [key, m] of modelTokens) {
    const t = turns.get(key);
    if (t) t.model = [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }

  // prevInterrupted: walk each session's turns in time order.
  const bySession = new Map<string, Turn[]>();
  for (const t of turns.values()) {
    const l = bySession.get(t.sessionId) ?? [];
    l.push(t);
    bySession.set(t.sessionId, l);
  }
  for (const list of bySession.values()) {
    list.sort((a, b) => a.firstAt - b.firstAt);
    list.forEach((t, i) => { t.number = i + 1; });
    for (let i = 1; i < list.length; i++) list[i]!.prevInterrupted = list[i - 1]!.interrupted;
    // A turn opened by harness plumbing rather than a person still answers to the last real ask.
    let lastPrompt: PromptEvent | null = null;
    for (const t of list) {
      if (t.prompt) lastPrompt = t.prompt;
      else if (!t.interrupted) t.prompt = lastPrompt;
    }
  }
  return { turns, editsByFile, shells, agents, harnessOf };
}
