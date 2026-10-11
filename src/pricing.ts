import type { Usage } from './types.js';

/** USD per million tokens. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type PriceTable = Record<string, Price>;

/**
 * List prices on the vendors' own pages on this date. Subscription users are not
 * billed this way, which is why dollars are opt-in; API users can override with
 * --prices when their rates differ.
 */
export const PRICES_AS_OF = '2026-10-06';

export const PRICES: PriceTable = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'gpt-5.6': { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  'gpt-5.6-sol': { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  'gpt-5.5': { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
};

/** Exact id first, then the longest key the id starts with, so dated snapshots still price. */
export function priceFor(model: string | null, table: PriceTable): Price | null {
  if (!model) return null;
  if (table[model]) return table[model]!;
  const prefix = Object.keys(table).filter((k) => model.startsWith(k + '-') || model.startsWith(k + '@')).sort((a, b) => b.length - a.length)[0];
  return prefix ? table[prefix]! : null;
}

export function estimateUsd(u: Usage, model: string | null, table: PriceTable): number | null {
  const p = priceFor(model, table);
  if (!p) return null;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

export function mergePrices(base: PriceTable, over: PriceTable): PriceTable {
  return { ...base, ...over };
}

export function isPriceTable(v: unknown): v is PriceTable {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((p) => {
    if (p === null || typeof p !== 'object') return false;
    const r = p as Record<string, unknown>;
    return ['input', 'output', 'cacheRead', 'cacheWrite'].every((k) => typeof r[k] === 'number');
  });
}
