import type { AnnotatedDiff } from '../types.js';

export function renderJson(d: AnnotatedDiff): string {
  return JSON.stringify(d, null, 2) + '\n';
}
