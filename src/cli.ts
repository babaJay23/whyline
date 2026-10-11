#!/usr/bin/env node
import { homedir } from 'node:os';
import { run } from './main.js';

// `whyline | head` closes our stdout early; that is not an error worth a stack trace.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(), home: homedir(), env: process.env, stdout: process.stdout, stderr: process.stderr, now: () => Date.now(),
});
