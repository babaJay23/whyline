import { readFileSync } from 'node:fs';

export function readJsonl(path: string): { rows: unknown[]; skipped: number } {
  const rows: unknown[] = [];
  let skipped = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      skipped++;
    }
  }
  return { rows, skipped };
}

export function firstLine(path: string): unknown | null {
  const text = readFileSync(path, 'utf8');
  const nl = text.indexOf('\n');
  try {
    return JSON.parse(nl === -1 ? text : text.slice(0, nl));
  } catch {
    return null;
  }
}

/** Narrow unknown to a string-keyed object without asserting its shape. */
export function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
export const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
