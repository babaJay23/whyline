const ISSUE = /(?<![\w/])#\d{2,}\b|\b(?!UTF|SHA|ISO|CVE|RFC\d)[A-Z]{2,}[A-Z0-9]*-\d+\b/g;
const URL = /https?:\/\/[^\s)>\]'"]+/g;
const DIR = /(?:^|[\s'"(`])((?:docs|specs?|adr|adrs|rfcs?|design)\/[^\s'")`]+)/gi;
const FILE = /(?:^|[\s'"(`])([^\s'")`]+\.[a-z]{1,5})(?=[\s'")`,;:]|$)/gi;
const SPEC_WORD = /(?:^|[-_.])(?:spec|specs|adr|rfc|design|plan)(?:[-_.]|$)/i;

/** Things a prompt or commit message can point at to say "this is what I am implementing". */
export function specReferences(text: string): string[] {
  const out: { at: number; ref: string }[] = [];
  for (const m of text.matchAll(ISSUE)) out.push({ at: m.index!, ref: m[0] });
  for (const m of text.matchAll(URL)) out.push({ at: m.index!, ref: m[0] });
  for (const m of text.matchAll(DIR)) out.push({ at: m.index! + m[0].length - m[1]!.length, ref: m[1]! });
  for (const m of text.matchAll(FILE)) {
    const ref = m[1]!;
    const base = ref.split('/').pop()!.replace(/\.[a-z]{1,5}$/i, '');
    if (SPEC_WORD.test(base)) out.push({ at: m.index! + m[0].length - ref.length, ref });
  }
  out.sort((a, b) => a.at - b.at);
  return [...new Set(out.map((o) => o.ref))];
}
