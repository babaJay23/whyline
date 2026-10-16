#!/bin/sh
# Builds the scenario the README example shows: a repo, a fake Claude Code session that was asked
# for one enum member and also changed a retry count, plus a hand-written TODO.md.
# Run inside an empty git repo with HOME pointed at an empty directory.
set -eu
mkdir -p src
printf 'export enum Mode {\n  TRANSLATION = "translation",\n  TEXT_TO_SPEECH = "tts",\n}\n' > src/modes.ts
printf 'export const retries = 3;\n' > src/config.ts
git -c user.name=demo -c user.email=demo@example.com add -A
git -c user.name=demo -c user.email=demo@example.com commit -qm init
sleep 1.2
cwd=$(pwd -P)
slug=$(printf '%s' "$cwd" | sed 's/[^A-Za-z0-9]/-/g')
mkdir -p "$HOME/.claude/projects/$slug"
python3 - "$cwd" "$HOME/.claude/projects/$slug/demo.jsonl" <<'PY'
import json, sys, time, datetime
cwd, out = sys.argv[1], sys.argv[2]
t0 = time.time() - 0.5
def ts(d): return datetime.datetime.fromtimestamp(t0 + d, datetime.UTC).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
u = lambda i, o, cr=0: {"input_tokens": i, "output_tokens": o, "cache_read_input_tokens": cr, "cache_creation_input_tokens": 0}
rows = [
  {"type": "user", "uuid": "u1", "promptId": "p1", "timestamp": ts(0), "cwd": cwd, "sessionId": "demo", "origin": {"kind": "human"},
   "message": {"role": "user", "content": "add a TRANSCRIPTION member to the enum in src/modes.ts (#31)"}},
  {"type": "assistant", "uuid": "a1", "requestId": "r1", "timestamp": ts(0.1), "cwd": cwd, "sessionId": "demo",
   "message": {"model": "claude-opus-5", "role": "assistant", "content": [{"type": "text", "text": "Adding TRANSCRIPTION after TEXT_TO_SPEECH. While here, the retry count in config looks low for speech, so I'll raise it."}], "usage": u(1800, 60, 24000)}},
  {"type": "assistant", "uuid": "a2", "requestId": "r2", "timestamp": ts(0.2), "cwd": cwd, "sessionId": "demo",
   "message": {"model": "claude-opus-5", "role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "Edit", "input": {"file_path": cwd + "/src/modes.ts", "old_string": '  TEXT_TO_SPEECH = "tts",', "new_string": '  TEXT_TO_SPEECH = "tts",\n  TRANSCRIPTION = "stt",', "replace_all": False}}], "usage": u(200, 40, 24000)}},
  {"type": "assistant", "uuid": "a3", "requestId": "r3", "timestamp": ts(0.3), "cwd": cwd, "sessionId": "demo",
   "message": {"model": "claude-opus-5", "role": "assistant", "content": [{"type": "tool_use", "id": "t2", "name": "Edit", "input": {"file_path": cwd + "/src/config.ts", "old_string": "export const retries = 3;", "new_string": "export const retries = 5;", "replace_all": False}}], "usage": u(150, 30, 24000)}},
]
open(out, 'w').write('\n'.join(json.dumps(r) for r in rows) + '\n')
PY
printf 'export enum Mode {\n  TRANSLATION = "translation",\n  TEXT_TO_SPEECH = "tts",\n  TRANSCRIPTION = "stt",\n}\n' > src/modes.ts
printf 'export const retries = 5;\n' > src/config.ts
printf 'scratch notes\n' > TODO.md
printf '{ "forbid": ["unrequested"], "maxUntracedRatio": 0.2 }\n' > .whyline.json
