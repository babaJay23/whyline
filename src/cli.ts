#!/usr/bin/env node
import { homedir } from 'node:os';
import { run } from './main.js';

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(), home: homedir(), env: process.env, stdout: process.stdout, stderr: process.stderr, now: () => Date.now(),
});
