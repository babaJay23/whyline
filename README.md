# whyline

Review what an AI coding agent did before you commit it.

`whyline` reads the session transcripts that Claude Code and Codex already write to disk, matches every changed hunk in your diff back to the prompt and edit that produced it, and tells you which hunks to look at first.

```
$ npx whyline
3 hunks across 3 files, 2 need a look: 1 untraced, 1 unrequested

TODO.md @@ -0,0 +1 @@
  ! untraced  no structured edit covers these lines
  (no provenance)
+scratch notes

src/config.ts @@ -1 +1 @@
  ! unrequested  prompt named src/modes.ts
  turn p1 · claude-code · main agent · 74.3k tokens · 2026-10-11 03:00
  prompt: add a TRANSCRIPTION member to the enum in src/modes.ts
  reasoning: Adding TRANSCRIPTION after TEXT_TO_SPEECH. While here, the retry count in config looks low for speech, so I'll raise it.
-export const retries = 3;
+export const retries = 5;

unflagged:
  src/modes.ts  1 hunk  1 turn  74.3k tokens
```

The agent was asked for one enum member. It also changed a retry count in a file nobody mentioned, and explained why in a sentence you would have scrolled past. The `TODO.md` was written by hand. The hunk you asked for is one line in the summary.

No install, no hooks, no account. It works on sessions you ran last week.

## What it flags

| flag | meaning |
|---|---|
| `untraced` | no structured edit in any session accounts for these lines. Hand edits, shell edits (`sed`, heredocs), or a session whyline could not find. |
| `unrequested` | your prompt named specific files and this is not one of them, nor imported by one. Only raised when the prompt named a file. |
| `after-correction` | written in a turn that started with "no", "don't", "revert", "wrong", "instead"… or right after you interrupted the agent. |
| `drifted` | an earlier edit in this file did not match when replayed, so attribution after it is best-effort. |
| `churned` | the same lines were rewritten across three or more turns. |
| `subagent` | written by a spawned agent whose reasoning you never saw directly. |

Every flag is a plain rule over the transcript and the diff. No model is called. When whyline cannot prove where a line came from, it says `untraced` instead of guessing.

## Usage

```
npx whyline                  # working tree vs HEAD, flagged hunks first
npx whyline --all            # every hunk
npx whyline main..HEAD       # any git range
npx whyline --html out.html  # self-contained report
npx whyline --json           # everything, for scripts
npx whyline sessions         # which sessions it found for this repo
npx whyline doctor           # what it can and cannot see on this machine
```

Sessions are matched to the repo by their working directory and to the diff by time. `--since 7d` and `--session <id>` override that.

## How it works

1. Adapters read `~/.claude/projects/**` and `~/.codex/sessions/**` into one event stream: prompts, reasoning, edits, shell commands, token usage, subagent spawns, interrupts.
2. A ledger replays the structured edits (Claude's `Edit`/`Write`, Codex's `apply_patch`) in order and remembers which edit last wrote each line.
3. The resolver runs `git diff --unified=0`, looks each added line up in the ledger, attaches the prompt, reasoning, agent and turn cost, and applies the flag rules.
4. Terminal, HTML and JSON renderers print the same result.

Edits made through shell commands have no structured record in either harness, so those lines come out `untraced`. That is a gap in the data, and whyline reports it rather than papering over it.

## Privacy

Transcripts are your private conversations. whyline makes no network calls of any kind, has zero runtime dependencies, and writes nothing except the file you name with `--html`. CI fails if any network module appears in `src/`.

## Related tools

- [Agit](https://github.com/agitHQ/agit) and [Entire](https://github.com/entireio/cli) answer "which prompt wrote this line" with `blame` and `why` commands, and go further on session sharing, forking and team capture. whyline builds the same provenance layer but puts the review question first: which hunks should I worry about?
- [Agent Blame](https://github.com/mesa-dot-dev/agentblame) marks lines as AI- or human-written via editor hooks.

## Requirements

Node 20 or newer, git, and at least one Claude Code or Codex session run inside the repo.

## License

MIT
