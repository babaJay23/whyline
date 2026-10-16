const ISSUE = /(?<![\w/])#\d{2,}\b|\b[A-Z][A-Z0-9]+-\d+\b/g;
const URL = /https?:\/\/[^\s)>\]'"]+/g;
const PATH = /(?:^|[\s'"(`])((?:docs|specs?|adr|adrs|rfcs?|design)\/[^\s'")`]+|[^\s'")`/]*(?:spec|adr|rfc|design|plan)[^\s'")`/]*\.[a-z]{1,5})/gi;

/** Things a prompt or commit message can point at to say "this is what I am implementing". */
export function specReferences(text: string): string[] {
  const out: { at: number; ref: string }[] = [];
  for (const m of text.matchAll(ISSUE)) out.push({ at: m.index!, ref: m[0] });
  for (const m of text.matchAll(URL)) out.push({ at: m.index!, ref: m[0] });
  for (const m of text.matchAll(PATH)) out.push({ at: m.index! + m[0].length - m[1]!.length, ref: m[1]! });
  out.sort((a, b) => a.at - b.at);
  return [...new Set(out.map((o) => o.ref))];
}
