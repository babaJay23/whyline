import { adapters } from './adapters/index.js';
import type { Session, SessionRef, Window } from './types.js';

export type Selection =
  | { all: true }
  | { window: Window; ids?: string[] };

export async function findSessions(
  repoRoot: string,
  home: string,
  opts: Selection,
): Promise<{ selected: Session[]; all: SessionRef[] }> {
  const all: SessionRef[] = [];
  for (const a of adapters) all.push(...(await a.discover(repoRoot, home)));
  all.sort((a, b) => a.startedAt - b.startedAt);

  const wanted = 'all' in opts
    ? all
    : opts.ids
      ? all.filter((r) => opts.ids!.some((id) => r.id.startsWith(id)))
      : all.filter((r) => r.startedAt <= opts.window.to && r.endedAt >= opts.window.from);

  const selected: Session[] = [];
  for (const ref of wanted) {
    const adapter = adapters.find((a) => a.harness === ref.harness)!;
    const { events, skipped } = await adapter.read(ref);
    selected.push({ ref, events, skipped });
  }
  return { selected, all };
}
