# whyline v0.2 to v0.4: durable intent records

**Date:** 2026-10-15
**Status:** proposed
**Builds on:** `docs/design.md` (v0.1, local review)

## 1. Why

v0.1 answers "which hunks should I look at" on the machine where the agent ran, while the transcript still exists. Claude Code deletes transcripts after 30 days by default. So the record of what was asked, what the agent said, and what it cost has a 30-day half-life and never leaves the laptop. A reviewer, an auditor, or the same engineer a quarter later gets nothing.

Governance-grade provenance follows the supply-chain pattern (SLSA, in-toto): captured automatically at the source, attached to the artifact, metadata not raw material, tamper-evident, checkable by policy. These three releases take whyline from one to five of those properties while keeping the two promises that define it: no model calls, and transcripts never leave the machine.

## 2. The intent record

One record per commit, stored in git notes under `refs/notes/whyline`. Notes travel with `git push`/`git fetch` of that ref, survive squash merges when re-attached on the merge commit, and are plain JSON a human can read with `git notes --ref whyline show <sha>`.

```ts
interface IntentRecord {
  schemaVersion: 1;
  whyline: string;              // version that wrote it
  commit: string;               // full sha
  createdAt: string;            // RFC 3339
  prompts: boolean;             // false when written with --no-prompts: prompt and reasoning text are ""
  record: AnnotatedDiff;        // exactly what `whyline <parent>..<commit> --json` printed
  hash: string;                 // "sha256:<hex>" over canonical JSON of {commit, createdAt, prompts, record}
  signature: { format: 'ssh'; signer: string; namespace: 'whyline'; sig: string } | null;
}
```

Canonical JSON: keys sorted recursively, no whitespace, UTF-8. The hash makes any later edit detectable; the signature says who produced it. Both are optional to verify and cheap to check.

What is deliberately not in the record: the transcript, tool outputs, full reasoning. The prompt and reasoning excerpts are the same 120 and 160 characters the terminal shows. `--no-prompts` blanks them for public repos.

## 3. v0.2: attach, read back, export

**`whyline attach [range] [--no-prompts] [--sign] [--push] [--quiet]`**
Default range is `HEAD` (one commit). For a range, one record per commit, each resolved against its first parent, from local transcripts. Writes the note with `git notes --ref whyline add -f`. `--push` runs `git push <remote> refs/notes/whyline` afterwards; whyline itself still opens no sockets. Exit 3 when no sessions cover a commit (nothing is written for it; others proceed). `--quiet` prints only errors, for hooks.

**Reading back.** `whyline <range>` keeps working from local transcripts. When no local session overlaps the window, it looks for notes on the commits in the range; if every commit has one, it merges their records and renders as usual, with a one-line banner `from attached records (N commits)`. `--from-notes` forces that path; `--no-notes` forbids it. Records with `prompts: false` render "you asked: (not recorded)".

Merging records: files are concatenated in commit order; hunk line numbers are those of each commit's own diff, so the merged view is per-commit-accurate rather than a single consolidated diff. The header says which commit each hunk belongs to.

**`whyline export [range] --format agent-trace [--from-notes]`**
Prints one Agent Trace v0.1 record per commit, as JSON lines. Mapping:
- `version: "0.1"`, `id`: UUID v4, `timestamp`: record `createdAt`, `vcs: {type: 'git', revision}`, `tool: {name: 'whyline', version}`.
- `files[].path`; `conversations[]` one per (session, turn, agent) that touched the file; `url: whyline://<harness>/<sessionId>/turn/<n>`; `related: [{type:'prompt', url: <same url>#prompt}]`; `contributor: {type:'ai', model_id: '<provider>/<model>'}` with provider `anthropic` for `claude-*`, `openai` for `gpt-*`, else `unknown`. Untraced hunks become a conversation with `contributor: {type: 'unknown'}` and no url.
- `ranges[]`: `start_line: newStart`, `end_line: newStart + newLines - 1` (a pure deletion is omitted; Agent Trace has no removed ranges).
- `metadata.whyline`: `{ flags: [{path, start_line, end_line, flag, detail}], prompts: boolean, cost: Usage }` so nothing whyline knows is lost in the mapping.

**`whyline verify [range]`**
Per commit: `attached` or `missing`; hash `ok`/`MISMATCH`; signature `unsigned`, `signed by <principal>`, or `BAD`. Exit 0 only when every commit in the range has a record whose hash matches and whose signature, if present, verifies. Verification uses `ssh-keygen -Y verify` against `git config gpg.ssh.allowedSignersFile`.

## 4. v0.3: automatic capture, specs, signatures

**`whyline install [--sign] [--no-prompts]` / `whyline uninstall`**
Writes a `post-commit` hook into the repo's hooks directory (honors `core.hooksPath`) containing one line: `whyline attach HEAD --quiet [--sign] [--no-prompts] || true`. Appends to an existing hook rather than replacing it, between marker comments, so `uninstall` can remove exactly its lines. The hook never blocks a commit: attach failures are swallowed and surface in `whyline doctor` as `last attach failed: <reason>` (recorded in `.git/whyline-last-error`). This is a git hook, not a harness hook, so it works for any agent whose transcripts whyline can read, with no change to Claude Code or Codex settings.

**Signing.** `--sign` signs the record hash with `ssh-keygen -Y sign -n whyline` using the key from `git config user.signingkey` when `gpg.format` is `ssh`, or `--key <path>`. The signer principal is `git config user.email`. No key configured means `--sign` exits 1 with the two git config commands to run. Zero dependencies: `ssh-keygen` ships with every git-capable machine whyline targets.

**The `unspecified` flag.** A hunk is unspecified when nothing in its turn, or any earlier turn of the same session, references a spec. A spec reference is any of: an issue or ticket id (`#123`, `ABC-123`), a URL, a path under `docs/`, `specs/`, `adr/`, `rfcs/`, `design/`, or any file whose basename contains `spec`, `adr`, `rfc`, `design` or `plan`, or a `Spec:`/`Ref:`/`Issue:` trailer in the commit message. The detail names what was found when the hunk is specified by inheritance (`spec from turn 2: #449`) so reviewers can judge the link. Severity sits between `after-correction` and `drifted`. The rule is deterministic and documented in the README next to the others.

Doctor gains two lines: whether a hook is installed, and whether signing is configured.

## 5. v0.4: policy checks for CI

**`whyline check [range] [--policy <file>] [--format text|md] [--from-notes]`**
Evaluates a policy against the merged records of the range and prints a verdict. Exit 0 on pass, 4 on violation, 3 when records are missing and the policy requires them. Default policy, when no file is given, is report-only: it prints the summary and exits 0.

Policy file, every key optional:

```json
{
  "requireRecords": true,
  "requireSignature": true,
  "maxUntracedRatio": 0.2,
  "forbid": ["unspecified", "unrequested"],
  "subagentNeedsBrief": true,
  "allowedSigners": ["alice@example.com"]
}
```

`--format md` prints a GitHub-flavoured Markdown comment: verdict line, a table of violations, then the turn groups in brief form. This is what a CI job posts on a PR.

**Reference GitHub Action** in the README: checkout with `fetch-depth: 0`, `git fetch origin refs/notes/whyline:refs/notes/whyline`, `npx whyline check origin/main...HEAD --policy .whyline.json --format md`, then post the output with the standard comment action. Documented plainly as self-reported provenance: a gate on the author's honesty, useful as a review aid, not a security control.

The main command gains `--format md` too, so a developer can paste a report into a PR description by hand without CI.

## 6. What does not change

No model calls. No network from whyline's own code (git push is git's, user-initiated, and only ever carries the record). Transcripts never leave the machine. Unknown stays unknown: a record that cannot be found is `missing`, a line that cannot be traced is `untraced`, a model that cannot be priced is unpriced.

## 7. Trust boundary, stated once

Records are produced on the author's machine from the author's transcripts and are therefore self-reported. The hash proves the record was not altered after it was written; the signature proves which key wrote it; neither proves the transcript was honest. `check` is a review aid and a nudge, not an authorization control, and the README says so in those words.

## 8. Release plan

| Version | Ships | Done when |
|---|---|---|
| 0.2.0 | `attach`, notes fallback, `export --format agent-trace`, `verify` (hash) | a record round-trips: attach on one machine, clone elsewhere, `whyline` renders it; export validates against the Agent Trace schema |
| 0.3.0 | `install`/`uninstall`, `--sign` and signature verification, `unspecified` flag | a fresh commit gets a signed record with no manual step; `verify` reports the signer |
| 0.4.0 | `check` with policy, `--format md`, GitHub Action docs | the Action posts a comment on a PR in a test repo and fails on a forbidden flag |

Each is tagged and published separately so users can adopt the local tool without the hook.
