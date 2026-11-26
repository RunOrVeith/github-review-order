import { expect, test } from 'vitest';
import { parseUnifiedDiff } from '@/utils/unified-diff';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,3 @@
 keep
-old one
-old two
+new one
 keep
@@ -10 +10,3 @@ function context() {
 keep
+added at 11
+added at 12
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 3333333..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-first
-second
\\ No newline at end of file
diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+only line
`;

test('numbers removed lines in the old file and added ones in the new file', () => {
  const { removed, added } = parseUnifiedDiff(DIFF);

  expect(removed.map(({ path, line, text }) => [path, line, text])).toEqual([
    ['src/a.ts', 2, 'old one'],
    ['src/a.ts', 3, 'old two'],
    ['gone.ts', 1, 'first'],
    ['gone.ts', 2, 'second'],
  ]);
  expect(added.map(({ path, line, text }) => [path, line, text])).toEqual([
    ['src/a.ts', 2, 'new one'],
    ['src/a.ts', 11, 'added at 11'],
    ['src/a.ts', 12, 'added at 12'],
    ['new.ts', 1, 'only line'],
  ]);
});

test('lines changed between the same unchanged lines share a run', () => {
  const { removed, added } = parseUnifiedDiff(DIFF);
  const [oldOne, oldTwo] = removed;
  const [newOne, at11, at12] = added;

  expect(oldOne!.run).toBe(oldTwo!.run);
  expect(newOne!.run).toBe(oldOne!.run);
  expect(at11!.run).toBe(at12!.run);
  expect(at11!.run).not.toBe(newOne!.run);
});

test('keeps whitespace in the text and drops carriage returns', () => {
  const diff = '--- a/x.py\r\n+++ b/x.py\r\n@@ -1 +1 @@\r\n-  indented\r\n+\tindented\r\n';
  const { removed, added } = parseUnifiedDiff(diff);

  expect(removed[0]!.text).toBe('  indented');
  expect(added[0]!.text).toBe('\tindented');
});

test('takes the path of a renamed file from its new name', () => {
  const diff = `diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
--- a/old/name.ts
+++ b/new/name.ts
@@ -1 +1 @@
-before
+after
`;
  const { removed, added } = parseUnifiedDiff(diff);

  expect(removed[0]!.path).toBe('new/name.ts');
  expect(added[0]!.path).toBe('new/name.ts');
});

test('reads paths git quotes, with octal escapes for non-ASCII bytes', () => {
  const diff = `--- "a/docs/caf\\303\\251 \\"menu\\".md"
+++ "b/docs/caf\\303\\251 \\"menu\\".md"
@@ -1 +1 @@
-a
+b
`;
  expect(parseUnifiedDiff(diff).added[0]!.path).toBe('docs/café "menu".md');
});

test('treats lines that look like headers as content inside a hunk', () => {
  const diff = `--- a/notes.md
+++ b/notes.md
@@ -1,2 +1,2 @@
--- a/not-a-header
+++ b/not-a-header
 diff --git a/x b/x
`;
  const { removed, added } = parseUnifiedDiff(diff);

  expect(removed.map((line) => line.text)).toEqual(['-- a/not-a-header']);
  expect(added.map((line) => line.text)).toEqual(['++ b/not-a-header']);
  expect(removed[0]!.path).toBe('notes.md');
});
