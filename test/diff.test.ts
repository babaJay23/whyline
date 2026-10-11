import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, syntheticAdded } from '../src/resolve/diff.js';

const sample = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -2 +2 @@ export function f() {
-  return 1;
+  return 2;
@@ -10,0 +11,2 @@ export function g() {
+  const x = 1;
+  return x;
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old.md b/renamed.md
similarity index 90%
rename from old.md
rename to renamed.md
--- a/old.md
+++ b/renamed.md
@@ -1 +1 @@
-# Old
+# New
diff --git a/img.png b/img.png
index 5555555..6666666 100644
Binary files a/img.png and b/img.png differ
`;

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(sample);

  it('parses one FileDiff per text file and skips binaries', () => {
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'new.txt', 'gone.txt', 'renamed.md']);
  });

  it('parses hunk ranges with and without counts', () => {
    const [a] = files;
    expect(a!.hunks[0]).toEqual({ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, removed: ['  return 1;'], added: ['  return 2;'] });
    expect(a!.hunks[1]).toEqual({ oldStart: 10, oldLines: 0, newStart: 11, newLines: 2, removed: [], added: ['  const x = 1;', '  return x;'] });
  });

  it('marks status', () => {
    expect(files.map((f) => f.status)).toEqual(['modified', 'added', 'deleted', 'renamed']);
    expect(files[3]!.oldPath).toBe('old.md');
    expect(files[0]!.oldPath).toBeNull();
  });

  it('keeps a trailing \\r on lines so CRLF files stay byte-exact', () => {
    const crlf = parseUnifiedDiff('diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\r\n+b\r\n');
    expect(crlf[0]!.hunks[0]!.added).toEqual(['b\r']);
  });

  it('ignores "\\ No newline at end of file" markers', () => {
    const d = parseUnifiedDiff('diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n');
    expect(d[0]!.hunks[0]).toMatchObject({ removed: ['a'], added: ['b'] });
  });

  it('builds a synthetic all-added diff', () => {
    const f = syntheticAdded('x.ts', 'one\ntwo\n');
    expect(f).toEqual({ path: 'x.ts', oldPath: null, status: 'added', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, removed: [], added: ['one', 'two'] }] });
    expect(syntheticAdded('e.ts', '').hunks).toEqual([]);
  });
});
