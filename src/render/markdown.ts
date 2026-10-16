import type { AnnotatedDiff } from '../types.js';
import type { Violation } from '../policy.js';
import { costLine, fmtTokens, fmtUsd, verdict } from './terminal.js';
import { groupHunks, oneLine, range, stamp, who, type Entry } from './groups.js';

/** GitHub-flavoured Markdown for a PR description or comment. No diff bodies: the PR already shows the diff. */
export function renderMarkdown(d: AnnotatedDiff, opts: { all: boolean; banner?: string; violations?: Violation[] }): string {
  const out: string[] = [`**${verdict(d)}**`];
  const cost = costLine(d);
  if (cost) out.push(cost);
  if (opts.banner) out.push(opts.banner);
  out.push('');
  if (opts.violations?.length) {
    out.push('| rule | detail |', '|---|---|');
    for (const v of opts.violations) out.push(`| ${cell(v.rule)} | ${cell(v.detail)} |`);
    out.push('');
  }
  const { groups } = groupHunks(d, { all: opts.all });
  for (const g of groups) {
    const p = g.lead;
    if (p) {
      out.push(`### turn ${p.turnNumber} · ${p.harness} · ${who(p)} · ${stamp(p.at)} · ${fmtTokens(p.turnCost)}${fmtUsd(p.turnCostUsd)}`);
      if (p.agentBrief) out.push(`**brief:** ${oneLine(p.agentBrief, 200)}`);
      out.push(`**you asked:** ${p.prompt.text === '' ? '(not recorded)' : oneLine(p.prompt.text, 200)}`);
      if (p.reasoning && p.reasoning.text !== '') out.push('<details><summary>agent said</summary>', '', p.reasoning.text.trim(), '</details>');
      out.push('');
    } else {
      out.push('### no turn found');
    }
    for (const e of g.entries) out.push(bullet(e));
    out.push('');
  }
  return out.join('\n');
}

function bullet({ f, h }: Entry): string {
  const where = `\`${f.path}\`${f.commit ? ` (${f.commit})` : ''} ${range(h)}`;
  const flags = h.flags.map((x) => `**${x.flag}**: ${oneLine(x.detail, 160)}`).join('; ');
  return flags ? `- ${where} — ${flags}` : `- ${where}`;
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
