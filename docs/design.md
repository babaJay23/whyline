# whyline — design spec

**Date:** 2026-10-10
**Status:** implemented in v0.1.0
**One line:** `whyline` reads the diff you are about to commit and tells you which hunks you never asked for, which came after you corrected the agent, which a subagent wrote, and which it cannot trace. Under each flag it shows the proof: the prompt, the agent's reasoning, the agent, and what the turn cost.

## 1. Problem

After an agentic coding session (Claude Code, Codex), a developer reviews a diff and cannot cheaply answer, per hunk: did I ask for this, did the agent decide it alone, was this the retry after I corrected it, did a subagent write it, and what did it cost? The answers exist in the session transcripts the harnesses already write to disk, but nobody reads them.

Evidence gathered 2026-10-10 (Hacker News threads from the last four months, top-reacted open issues on anthropics/claude-code, GitHub repo search):

- The most-replied comment on the "Why Software Factories Fail" HN thread (394 pts) names PR review of agent output as where the workflow breaks.
- Issue #33932 (204 reactions) asks for a diff review UI; #21151 (186) asks which file a tool touched.
- Developers running parallel worktrees report inspecting each by hand with no way to tell why a hunk exists.
- Line-level lookup already exists. entireio/cli (5,172 stars, Go, hook-based, company-backed) has `entire blame` and `entire why file:line`. agitHQ/agit (6 stars, TypeScript, reads native logs from 13 harnesses with no hooks) has `agit blame` and `agit why`, and stops honestly at shell edits. mesa-dot-dev/agentblame (102 stars) marks lines AI-vs-human via editor hooks. All three answer "where did this line come from?"
- Nothing ships the review question: "which hunks in this diff should I worry about?" Nine GitHub searches and a web search found only a July 2026 arXiv paper (2607.29516) that defines "unrequested changes" and scores them with a model, and CodeRabbit's out-of-scope check at PR time against a linked issue. Neither is local, deterministic, or pre-commit.

**Positioning:** whyline builds the same provenance layer those tools have (it needs it as evidence), but leads with the flags. The README says this plainly and points readers to Agit for session forking and sharing, and to Entire for team-wide capture.

## 2. Users and success

**v1 user:** a solo developer who ran one or more agent sessions in a repo and wants to review the result locally before committing or opening a PR.

**Success:** run one command in the repo with no setup and get a verdict ("14 hunks, 3 need a look") with the flagged hunks first and the provenance under each as proof. Works on sessions already run in the past. Correct on every line it labels; honest ("untraced") on every line it cannot.

**Not v1:** team/PR surfaces, hook-based exact capture of shell edits, provenance stored in git. The ledger format is designed so those plug in later (section 10).

## 3. Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Direction | Agent provenance | Strongest pain, empty space, one-screenshot demo |
| Surface | Local CLI, solo dev | Fastest to ship, no auth |
| Harnesses | Claude Code + Codex | Both formats verified on disk; two harnesses makes it a category tool |
| Stack | TypeScript, npm, run via `npx` | Zero install friction, ecosystem language |
| Approach | Read existing transcripts, no install | Works retroactively; hooks and git notes deferred |
| Name | `whyline` | Free on npm; says what it answers; no collision with Agent Blame |

## 4. Inputs: what the harnesses write to disk

Verified on a real machine on 2026-10-10.

**Claude Code** — `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`, one JSON object per line. Relevant records:
- `type: "user"` with string `message.content` = a human prompt; carries `promptId`, `timestamp`, `cwd`, `gitBranch`, `sessionId`.
- `type: "assistant"` with `message.content[]` blocks of `text`, `thinking`, `tool_use`; carries `uuid`, `parentUuid`, `requestId`, `message.usage` (input, output, cache read, cache creation tokens).
- `tool_use` blocks with `name` in `Edit` (`file_path`, `old_string`, `new_string`, `replace_all`), `Write` (`file_path`, `content`), `Bash` (`command`), `Agent` (`subagent_type`, `description`, `prompt`).
- `type: "user"` tool-result rows carry `toolUseResult` with `filePath`, `oldString`, `newString`, `structuredPatch` for Edit/Write.
- Subagent transcripts live in `~/.claude/projects/<cwd-slug>/<session-id>/*.jsonl`; rows carry `isSidechain: true`.
- Also present and useful: `pr-link` rows (PR number/url), `file-history-delta` rows (which message wrote which file), `version`.

**Codex** — `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`. Relevant records:
- `type: "session_meta"` with `payload.cwd`, `session_id`, `cli_version`, `originator`.
- `type: "turn_context"` with `payload.turn_id`, `cwd`.
- `type: "event_msg"` with `payload.type` = `user_message` (`message`), `agent_message`, `reasoning`, `token_count` (`last_token_usage`).
- `type: "response_item"` with `payload.type` = `function_call` (`name` = `exec_command` etc., `arguments` JSON string, `call_id`, `...passthrough.turn_id`) or `custom_tool_call` with `name: "apply_patch"` and `input` in the `*** Begin Patch` / `*** Add File:` / `*** Update File:` / `*** Delete File:` format, and `function_call_output`.

**Known gap:** neither harness records the resulting file content when an edit is made through a shell command (`sed -i`, heredoc, script). Those lines are reported as untraced. Section 10 describes the v1.1 hook that closes this.

## 5. Architecture

Four stages. Each stage is a module with a pure interface; only adapters and the CLI touch the file system or git.

```
transcripts on disk ──▶ adapters ──▶ Event[] ──▶ ledger ──▶ LineTable per file
                                                                  │
git diff (range) ──▶ hunks ──────────────────────────▶ resolver ──▶ AnnotatedDiff
                                                                  │
                                                 renderers: terminal | html | json
```

### 5.1 Adapters (`src/adapters/`)

One module per harness exporting:

```ts
discover(repoRoot: string): Promise<SessionRef[]>   // sessions whose cwd is inside repoRoot
read(ref: SessionRef): Promise<Event[]>              // normalized, time-ordered
```

`SessionRef = { harness: 'claude-code' | 'codex', id, path, cwd, startedAt, endedAt, parentId? }`.

Claude Code `discover` scans every project directory and keeps sessions whose `cwd` equals or is under `repoRoot` (realpath compared). Subagent files are read and their events tagged with `agentId` = subagent session id and `parentTurnId` from the `Agent` tool_use that spawned them. Codex `discover` reads `session_meta.cwd` from the first line of each rollout file.

### 5.2 Event model

All adapters emit these and nothing else:

```ts
type Event =
  | { kind: 'prompt';     id; turnId; at; text; source: 'human' | 'tool-result' }
  | { kind: 'reasoning';  id; turnId; at; text; visible: boolean }   // text vs thinking
  | { kind: 'edit';       id; turnId; at; agentId; tool; file; op: EditOp }
  | { kind: 'shell';      id; turnId; at; agentId; command; touches: string[] }
  | { kind: 'usage';      turnId; at; input; output; cacheRead; cacheWrite }
  | { kind: 'spawn';      turnId; at; agentId; name; brief }
  | { kind: 'interrupt';  turnId; at }

type EditOp =
  | { type: 'replace'; old: string; new: string; all: boolean }
  | { type: 'write';   content: string }
  | { type: 'patch';   hunks: PatchHunk[] }      // Codex apply_patch, normalized
  | { type: 'delete' }
```

A **turn** is one human prompt and everything the agent did until the next human prompt. Claude Code: group by `promptId` on the prompt row, carried to assistant rows via the parent chain. Codex: `turn_id`. Subagent events keep their own `agentId` but inherit the parent's `turnId` so cost and flags roll up to the prompt that caused them.

`shell.touches` is a best-effort list of repo-relative paths that appear as tokens in the command string. Used only for the untraced hint ("a shell command in turn 12 mentioned this file"), never for attribution.

### 5.3 Ledger (`src/ledger/`)

Input: all edit events for one file, time-ordered, plus the file's content at the start of the window (from git: `git show <base>:<path>`, or empty for new files). Output:

```ts
type LineTable = { lines: { text: string; editId: string | null }[]; driftedAt: string | null }
```

Replay rules:
- `write`: every line gets this edit's id.
- `replace`: locate `old` exactly (first occurrence, or all when `all` is true) in the current text. Lines inside the replaced span get this edit's id; lines outside keep theirs. If `old` is not found, set `driftedAt = edit.id` and stop replaying this file. Later lines in the file keep whatever id they had; the resolver reports the file as drifted from that edit's timestamp.
- `patch`: apply hunks by context match; same drift rule on failure.
- `delete`: table becomes empty.

The ledger never reads the working tree. The resolver compares the ledger's final text to the actual file; a mismatch is reported (it means untraced edits happened) but does not stop annotation of lines that do match.

### 5.4 Resolver (`src/resolve/`)

Input: an `AnnotatedDiff` request `{ range, files }`, the diff hunks from `git diff <range> --unified=0`, the ledgers, and the event index. For each added or modified line in a hunk:

1. Look up the line in the ledger by matching the hunk's new-side line to the ledger's final text at the same position; fall back to nearest exact text match within ±3 lines.
2. If found, build `Provenance`:

```ts
type Provenance = {
  harness; sessionId; turnId; agentId; agentName | null;
  prompt: { text; at };
  reasoning: { text; at } | null;   // last visible reasoning in the same turn before the edit
  tool; editId; at;
  turnCost: { input; output; cacheRead; cacheWrite } | null;
}
```

3. If not found, provenance is `null` and the line is `untraced`.

Hunks are then flagged. Flags are deterministic; no model calls. A hunk may carry several flags.

| Flag | Rule |
|---|---|
| `untraced` | Any line in the hunk has null provenance. Hint attached if a `shell` event in the window `touches` this file. |
| `unrequested` | Evaluated only when the turn's prompt names at least one path or basename that exists in the repo; a prompt that names no file ("fix the failing tests") never raises it. Raised when this file is not among the named files and no named file imports or is imported by it. Import check: regex for `import`/`require`/`from` lines in the named files and this file, v1 supports JS/TS/Python. Rendered as "unrequested: prompt named a.ts, b.ts". |
| `after-correction` | The turn's prompt starts with or contains one of a fixed phrase list (`no`, `don't`, `do not`, `stop`, `revert`, `undo`, `that's wrong`, `wrong`, `instead`, `not what I`) as a whole word within the first 80 characters, or an `interrupt` event preceded the turn. |
| `subagent` | `agentId` differs from the session's main agent. Carries `agentName` and `spawn.brief`. |
| `churned` | Lines in this hunk were written by three or more distinct edits across the window. |
| `drifted` | The file's ledger has `driftedAt` earlier than this hunk's edit time. |

Per-file and per-review totals: turn cost summed over distinct turns that touched the file (a turn is counted once per file even if it made many edits).

### 5.5 Renderers (`src/render/`)

All three consume the same `AnnotatedDiff` object.

- **terminal** (default): first line is the verdict, e.g. `14 hunks across 6 files, 3 need a look: 2 unrequested, 1 after-correction`. Then flagged hunks, worst first (untraced, unrequested, after-correction, drifted, churned, subagent), then the rest only with `--all`. Each hunk is preceded by a header: flags on the first line, then `turn 12 · claude-code · main agent · 4.2k tokens`, the prompt (first 120 chars), the reasoning (first 160 chars). Lines keep normal `+`/`-` prefixes. Respects `NO_COLOR` and `--no-color`. A diff with no flagged hunks prints the verdict and the per-file provenance summary, nothing else.
- **html**: one self-contained file, inline CSS, no framework, no external requests. Top: the verdict and counts by flag. Left column: file list with flag counts. Main: flagged hunks first, each with flags as chips, expandable prompt and full reasoning, cost; unflagged hunks below, collapsed.
- **json**: the `AnnotatedDiff` object, stable keys, `schemaVersion: 1`.

### 5.6 CLI (`src/cli.ts`)

```
whyline [range] [--all] [--html <path>] [--json] [--since <date>] [--session <id>...] [--no-color]
whyline sessions           # table: harness, id, started, turns, edits, files touched
whyline doctor             # what directories were scanned, sessions found, lines skipped, gaps
```

Default range: working tree vs `HEAD`, including untracked files. `--all` shows unflagged hunks too (JSON and HTML always include everything). Session window: default is all sessions in this repo whose time span overlaps the commits in the range (for working tree, since the HEAD commit time); `--since` and `--session` override.

Exit codes: 0 success, 1 usage error, 2 not a git repo or no diff, 3 no sessions found (prints what directories were checked).

## 6. Non-goals for v1

No model calls of any kind. No quality or security opinions. No network. No daemon, hook, or editor plugin. No config file. No Cursor/Copilot/OpenCode adapters (format not verified locally; the adapter interface leaves room).

## 7. Error handling

- Malformed transcript line: skip, increment a counter surfaced by `doctor`. Never abort a session for one bad row.
- Edit replay failure: mark drifted, keep going for other files.
- Ledger final text ≠ working file: annotate matching lines, mark the rest untraced, note the mismatch in the file header.
- Sessions found but none overlap the range: exit 3 with the list of sessions and their time spans so the user can pass `--session`.
- Transcripts contain private conversation text. The tool reads them only to render output the user asked for and writes nothing except files the user named with `--html`/`--json`. The README states this on the first screen.

## 8. Testing

- `test/fixtures/claude-code/` and `test/fixtures/codex/`: real transcript excerpts, scrubbed of personal content, covering: plain Edit, Write of a new file, replace_all, a subagent spawn with child file, a Bash heredoc write, an interrupt, a correction prompt, a Codex apply_patch Add/Update/Delete.
- Adapter tests: fixture → expected `Event[]` (snapshot).
- Ledger tests: table-driven, including the drift case and overlapping edits.
- Resolver tests: one crafted case per flag that raises it and a sibling case that does not.
- Renderer tests: JSON snapshot; terminal output snapshot with color disabled; HTML asserts structure and that it contains no `http://`/`https://` references.
- End-to-end: build a temp git repo, copy a fixture transcript into a temp `HOME`, run the CLI, snapshot the JSON.
- Runner: vitest. CI: GitHub Actions on push, Node 20 and 22, macOS and Linux.

## 9. Release definition for v1

Both adapters; all six flags; terminal, HTML, JSON; `sessions` and `doctor`; tests green in CI; README with a real screenshot, a 20-second GIF, the privacy statement, and the positioning line against Agent Blame; MIT license; published to npm as `whyline`.

## 10. Designed-for-later (not built in v1)

- **v1.1 exact mode:** an optional `PostToolUse` hook (Claude Code) and Codex equivalent that snapshots touched files after each tool call into `~/.whyline/snapshots/<session>/`. The ledger accepts `{ type: 'snapshot'; content }` as a fifth `EditOp`, which closes the shell-edit gap. The hook is opt-in and installed by `whyline hook install`.
- **v2 git-native:** `whyline attach` writes a compact provenance map into `git notes` at commit time; `whyline` reads notes when transcripts are absent, enabling PR review on another machine.
- Additional adapters behind the same `discover`/`read` interface.
