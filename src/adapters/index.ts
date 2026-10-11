import type { Adapter } from '../types.js';
import { claudeCode } from './claude-code.js';
import { codex } from './codex.js';

export const adapters: Adapter[] = [claudeCode, codex];
