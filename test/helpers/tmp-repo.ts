import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function makeRepo(files: Record<string, string> = {}) {
  // realpath so the directory matches what `git rev-parse --show-toplevel` reports (macOS /var -> /private/var).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'whyline-repo-')));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      },
    }).trim();
  git('init', '-q', '-b', 'main');
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  for (const [p, c] of Object.entries(files)) write(p, c);
  const commit = (msg: string) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  return { dir, write, commit, git };
}
