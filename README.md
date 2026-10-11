# whyline

`git blame` tells you who wrote a line. `whyline` tells you which prompt wrote it, what the agent was thinking, which agent did it, what it cost, and whether it matches what you asked for.

Reads the session transcripts Claude Code and Codex already write to disk and annotates your `git diff` with provenance and review flags. No install, no hooks, no network.

Status: design phase. See [the spec](docs/superpowers/specs/2026-10-10-whyline-design.md).
