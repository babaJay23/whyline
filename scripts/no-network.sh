#!/bin/sh
# whyline reads private chat transcripts. It must never be able to send them anywhere.
set -eu
if grep -rnE "from 'node:(http|https|net|dgram|tls)'|from '(undici|axios|node-fetch)'|\bfetch\(" src/ ; then
  echo "network access found in src/; whyline must stay offline" >&2
  exit 1
fi
echo "no network access in src/"
