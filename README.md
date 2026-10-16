# whyline

Review what an AI coding agent did before you commit it.

`whyline` reads the session transcripts that Claude Code and Codex already write to disk, matches every changed hunk in your diff back to the prompt and edit that produced it, and tells you which hunks to look at first.

```
$ whyline

```

![whyline on a small change](docs/demo.gif)

The agent was asked for one enum member. It also changed a retry count in a file nobody mentioned, and explained why in a sentence you would have scrolled past. `TODO.md` was written by hand, so no turn accounts for it. The hunk you actually asked for is one line in the summary at the bottom.

No install, no hooks, no account. It works on sessions you ran last week.

## What it flags

| flag | meaning |
|---|---|
| `untraced` | no structured edit in any session accounts for these lines. Hand edits, shell edits (`sed`, heredocs), or a session whyline could not find. |
| `unrequested` | your prompt named specific files and this is not one of them, nor imported by one. Only raised when the prompt named a file. |
| `after-correction` | written in a turn whose prompt opens with "no", "stop" or "undo", or says "don't", "revert", "wrong" or "instead" in its first 80 characters, or that came right after you interrupted the agent. |
| `unspecified` | nothing in the turn, an earlier turn of the same session, or the commit message points at an issue, a URL, or a spec-like document. The "did anyone write down what this is for" signal. |
| `drifted` | an earlier edit in this file did not match when replayed, so attribution after it is best-effort. |
| `churned` | the same lines were rewritten across three or more turns. |
| `subagent` | written by a spawned agent whose reasoning you never saw directly. |

Every flag is a plain rule over the transcript and the diff. No model is called. When whyline cannot prove where a line came from, it says `untraced` instead of guessing.

## Install

```
npm i -g whyline
```

Or run it without installing: `npx whyline`.

## Usage

```
whyline                      # working tree vs HEAD, flagged hunks first
whyline --all                # every hunk
whyline main..HEAD           # any git range
whyline --html out.html      # self-contained report
whyline --json               # everything, for scripts
whyline --brief              # headers and flags only; cheap for an agent to read
whyline --format md          # Markdown for a PR description
whyline --prices default     # add dollar estimates at list prices
whyline sessions             # which sessions it found for this repo
whyline doctor               # what it can and cannot see on this machine
whyline attach [range]       # keep the record with the code (see below)
whyline verify [range]       # are the records present and unaltered?
whyline export [range] --format agent-trace
whyline check [range] --policy .whyline.json   # exit 4 on a violation (see below)
```

## More demos

**Brief mode and cost.** `--brief` prints the verdict, each turn's ask, and the flagged hunks with no diff bodies: a few lines an agent or a CI job can read cheaply. `--prices default` adds a dollar estimate per turn at the vendors' list prices; it is off unless asked for, because subscriptions are not billed per token.

![brief mode and prices](docs/demo-brief.gif)

**Keeping the record.** `attach` writes the report for a commit into git notes, with a hash. The note is plain JSON you can read with `git notes --ref whyline show`. `verify` checks that every commit in a range has a record and that none has been altered, on any machine with the notes fetched, with no transcript present.

![attach and verify](docs/demo-attach.gif)

**Policy in CI.** `check` evaluates a small JSON policy against the review and exits 4 on a violation. `--format md` prints the same result as Markdown for a pull request comment.

![check with a policy](docs/demo-check.gif)

## Tokens and cost

Every turn shows the tokens the model processed fresh and, separately, how many it read from cache. Cache reads are cheap per token but tell you how much context the turn was carrying.

Dollar figures are off by default, because Claude Code and Codex subscriptions are not billed per token. If you pay per token, `--prices default` prices each turn at the vendors' list prices (table dated in `src/pricing.ts`), and `--prices rates.json` lets you supply your own in USD per million tokens:

```json
{ "claude-opus-5": { "input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25 } }
```

A model with no price is reported as unpriced, never costed at zero.

whyline itself calls no model and spends no tokens. If an agent reads whyline's output, `--brief` gives it the verdict, each turn's ask, and the flagged hunks without the diff bodies.

Sessions are matched to the repo by their working directory and to the diff by time. `--since 7d` and `--session <id>` override that.

## How it works

1. Adapters read `~/.claude/projects/**` and `~/.codex/sessions/**` into one event stream: prompts, reasoning, edits, shell commands, token usage, subagent spawns, interrupts.
2. A ledger replays the structured edits (Claude's `Edit`/`Write`, Codex's `apply_patch`) in order and remembers which edit last wrote each line.
3. The resolver runs `git diff --unified=0`, looks each added line up in the ledger, attaches the prompt, reasoning, agent and turn cost, and applies the flag rules.
4. Terminal, HTML and JSON renderers print the same result.

Edits made through shell commands have no structured record in either harness, so those lines come out `untraced`. That is a gap in the data, and whyline reports it rather than papering over it.

## Privacy

Transcripts are your private conversations. whyline makes no network calls of any kind, has zero runtime dependencies, and writes nothing except the file you name with `--html`. CI fails if any network module appears in `src/`.

## Keeping the record

Transcripts are deleted by the harness after a while (Claude Code: 30 days). To keep the answer to "why is this line here" with the code:

```
whyline attach              # write an intent record for HEAD into git notes (refs/notes/whyline)
whyline attach main..HEAD   # one record per commit
whyline attach --push       # and push the notes ref to origin
whyline verify main..HEAD   # every commit attached, unaltered?
whyline install             # post-commit hook: attach a record to every commit from now on
whyline install --sign      # and sign it with your git ssh signing key
```

A record is exactly what `--json` prints for that commit, plus a hash. It holds the 120-character prompt excerpts and one line of agent reasoning per hunk, never the transcript. `--no-prompts` leaves even those out, for public repos.

On any machine with the notes fetched (`git fetch origin refs/notes/whyline:refs/notes/whyline`), `whyline <range>` renders from the records when no transcript is present, and says so in its second line.

`whyline export main..HEAD --format agent-trace` prints the same records in the [Agent Trace](https://agent-trace.dev) format, one JSON line per commit.

Signing uses `ssh-keygen -Y` with the key in `git config user.signingkey` (set `gpg.format ssh`); `verify` checks against `gpg.ssh.allowedSignersFile`, the same files git itself uses for signed commits.

Records are produced on the author's machine from the author's transcripts: self-reported. The hash proves a record was not altered after it was written; it does not prove the transcript was honest.

## In a pull request

On the author's machine, `whyline install` means every commit carries a record. Push the notes with the branch:

```
git push origin main refs/notes/whyline
```

Then a CI job can review the branch without any transcript:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- run: git fetch origin refs/notes/whyline:refs/notes/whyline
- run: npx whyline check origin/main...HEAD --policy .whyline.json --format md > whyline.md || true
- uses: marocchino/sticky-pull-request-comment@v2
  with: { path: whyline.md }
```

`.whyline.json`:

```json
{ "requireRecords": true, "maxUntracedRatio": 0.3, "forbid": ["unspecified"], "subagentNeedsBrief": true }
```

`check` exits 4 on a violation, so drop the `|| true` to fail the job.

What this is and is not: the record is produced on the author's machine from the author's transcripts. The hash proves it was not altered afterwards and a signature proves which key wrote it; neither proves the transcript was honest. Use `check` as a review aid and a nudge toward writing down what each change is for. It is not an authorization control.

## Related tools

- [Agit](https://github.com/agitHQ/agit) and [Entire](https://github.com/entireio/cli) answer "which prompt wrote this line" with `blame` and `why` commands, and go further on session sharing, forking and team capture. whyline builds the same provenance layer but puts the review question first: which hunks should I worry about?
- [Agent Blame](https://github.com/mesa-dot-dev/agentblame) marks lines as AI- or human-written via editor hooks.

## Requirements

Node 20 or newer, git, and at least one Claude Code or Codex session run inside the repo.

## License

MIT
