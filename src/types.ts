export type Harness = 'claude-code' | 'codex';

export interface SessionRef {
  harness: Harness;
  id: string;
  path: string;
  cwd: string;
  startedAt: number; // epoch ms
  endedAt: number;
}

export type EditOp =
  | { type: 'replace'; old: string; new: string; all: boolean }
  | { type: 'write'; content: string }
  | { type: 'delete' };

interface EventBase {
  id: string;
  sessionId: string;
  /** Equals sessionId for the main agent; the subagent id otherwise. */
  agentId: string;
  turnId: string;
  at: number;
}

export type PromptEvent = EventBase & { kind: 'prompt'; text: string };
export type ReasoningEvent = EventBase & { kind: 'reasoning'; text: string; visible: boolean };
export type EditEvent = EventBase & { kind: 'edit'; tool: string; file: string; op: EditOp };
export type ShellEvent = EventBase & { kind: 'shell'; command: string; touches: string[] };
export type UsageEvent = EventBase & { kind: 'usage'; model: string | null } & Usage;
export type SpawnEvent = EventBase & { kind: 'spawn'; childAgentId: string; name: string; brief: string };
export type InterruptEvent = EventBase & { kind: 'interrupt' };

export type Event =
  | PromptEvent | ReasoningEvent | EditEvent | ShellEvent
  | UsageEvent | SpawnEvent | InterruptEvent;

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Adapter {
  harness: Harness;
  /** Sessions whose cwd is repoRoot or inside it. `home` is the user's home dir (injectable for tests). */
  discover(repoRoot: string, home: string): Promise<SessionRef[]>;
  read(ref: SessionRef): Promise<{ events: Event[]; skipped: number }>;
}

export interface Session {
  ref: SessionRef;
  events: Event[];
  skipped: number;
}

// ---- diff ----

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  removed: string[];
  added: string[];
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  hunks: Hunk[];
}

// ---- ledger ----

export interface LedgerLine {
  text: string;
  editId: string | null;
}

export interface LineTable {
  lines: LedgerLine[];
  /** Timestamp of the first edit that failed to apply, or null. */
  driftedAt: number | null;
  failed: string[]; // edit ids that did not match
}

// ---- resolved output ----

export type Flag = 'untraced' | 'unrequested' | 'after-correction' | 'subagent' | 'churned' | 'drifted';

export interface FlagHit {
  flag: Flag;
  detail: string;
}

export interface Provenance {
  harness: Harness;
  sessionId: string;
  turnId: string;
  /** 1-based position of the turn within its session; what people read. */
  turnNumber: number;
  agentId: string;
  agentName: string | null;
  /** The task description the parent gave a subagent; null for the main agent. */
  agentBrief: string | null;
  prompt: { text: string; at: number };
  reasoning: { text: string; at: number } | null;
  tool: string;
  editId: string;
  at: number;
  turnCost: Usage | null;
  /** The model that did most of the turn's work, as the harness recorded it. */
  turnModel: string | null;
  /** Estimated USD for the turn; null without a price table or for an unpriced model. */
  turnCostUsd: number | null;
}

export interface AnnotatedLine {
  text: string;
  provenance: Provenance | null;
}

export interface AnnotatedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  removed: string[];
  lines: AnnotatedLine[];
  /** Provenance shared by most traced lines in the hunk, for the header. */
  lead: Provenance | null;
  otherTurns: number;
  flags: FlagHit[];
}

export interface AnnotatedFile {
  path: string;
  status: FileStatus;
  hunks: AnnotatedHunk[];
  turnIds: string[];
  cost: Usage | null;
  costUsd: number | null;
  /** Short sha when this file came from an attached record rather than a live diff. */
  commit?: string;
  ledgerMismatch: boolean;
  driftedAt: number | null;
}

export interface AnnotatedDiff {
  schemaVersion: 1;
  range: string;
  generatedAt: number;
  sessions: SessionRef[];
  files: AnnotatedFile[];
  totals: {
    files: number;
    hunks: number;
    flagged: Record<Flag, number>;
    cost: Usage;
    costUsd: number | null;
    unpricedModels: string[];
  };
}

export interface Window {
  from: number; // exclusive, epoch ms
  to: number;   // inclusive
}

export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}
