---
name: whyline
description: Before committing agent-written changes, run whyline to find hunks nobody asked for, changes made after a correction, subagent edits, and untraced lines; then fix or explain each one. Usage - /whyline, /whyline main..HEAD, /whyline --all
---

# whyline: review what the agent did before committing

whyline reads the Claude Code and Codex transcripts already on this machine, maps every hunk in the diff back to the prompt and edit that produced it, and flags the ones that need a human look. It calls no model and sends nothing anywhere.

## When to use

- Right before `git commit`, after an agentic session touched more than a file or two.
- Before opening a pull request, on the branch range: `/whyline main...HEAD`.
- When the user asks "what did you change that I didn't ask for?"

## Workflow

### Step 1: Make sure whyline is available

```bash
whyline --help >/dev/null 2>&1 || npx -y @nmdlabs/whyline --help >/dev/null
```

If neither works, tell the user to run `npm i -g @nmdlabs/whyline` and stop.

### Step 2: Run the brief review

Use `--brief`: it prints the verdict, each turn's ask, and the flagged hunks without diff bodies, which is all you need to decide where to look.

```bash
whyline --brief $ARGUMENTS
```

Exit codes: `0` ok, `2` no changes, `3` no session found for this repo (say so and stop; there is nothing to review).

### Step 3: Act on each flag

Read the flagged hunks top to bottom. For each one:

- **unrequested**: the prompt named other files. Either revert the hunk, or state in one sentence why it was necessary and ask the user whether to keep it. Do not keep it silently.
- **after-correction**: this was written after the user said no or interrupted. Re-read the correction and confirm the hunk actually follows it; if not, fix it.
- **subagent**: a spawned agent wrote this and the user never saw its reasoning. Summarize what it did in two sentences.
- **unspecified**: nothing points at an issue, URL or spec. Ask the user for the reference, or add a `Spec:` trailer to the commit message if they give one.
- **untraced**: no structured edit covers these lines. If you wrote them through a shell command, say so. If you did not write them, say that too; they may be the user's own.
- **churned** / **drifted**: mention them; they are signals of a struggle, not errors.

Show the full hunk with `whyline --all` only when the brief line is not enough to judge it.

### Step 4: Report, then commit

Give the user a short list: hunks kept and why, hunks reverted, anything that needs their answer. Only then run the commit the user asked for. If the repo has `whyline install`ed, the commit will carry its record automatically; otherwise offer `whyline attach`.

## Notes

- `whyline` with no range reviews the working tree against HEAD, including untracked files.
- `whyline --prices default` adds dollar estimates; leave it off unless the user asks.
- Never paste prompt text from the report into a public PR without checking it first; the report quotes the first 120 characters of each prompt.
