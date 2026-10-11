import { describe, it, expect } from 'vitest';
import { estimateUsd, priceFor, PRICES, PRICES_AS_OF, mergePrices } from '../src/pricing.js';

describe('pricing', () => {
  it('has a dated built-in table with the models these harnesses record', () => {
    expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-5.5']) expect(PRICES[m]).toBeDefined();
  });

  it('matches dated variants by prefix and returns null for unknown models', () => {
    expect(priceFor('claude-opus-5-20260101', PRICES)).toEqual(PRICES['claude-opus-5']);
    expect(priceFor('claude-opus-5-5', PRICES)).toEqual(PRICES['claude-opus-5-5']); // exact beats prefix
    expect(priceFor('codex-auto-review', PRICES)).toBeNull();
    expect(priceFor(null, PRICES)).toBeNull();
  });

  it('estimates dollars from the four usage fields', () => {
    const table = { m: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } };
    expect(estimateUsd({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, 'm', table)).toBeCloseTo(5);
    expect(estimateUsd({ input: 100_000, output: 10_000, cacheRead: 2_000_000, cacheWrite: 40_000 }, 'm', table)).toBeCloseTo(0.5 + 0.25 + 1 + 0.25);
    expect(estimateUsd({ input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, 'unknown', table)).toBeNull();
  });

  it('merges a user table over the built-in one', () => {
    const merged = mergePrices(PRICES, { 'gpt-5.5': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 }, 'my-model': { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 } });
    expect(merged['gpt-5.5']!.input).toBe(1);
    expect(merged['my-model']).toBeDefined();
    expect(merged['claude-opus-5']).toEqual(PRICES['claude-opus-5']);
  });
});
