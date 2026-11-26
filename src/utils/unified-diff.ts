/** A line a PR removes or adds. */
export interface ChangedLine {
  /** The file as GitHub's changes tab shows it: its new path, or the old one when it's deleted. */
  path: string;
  /** Its number in the old file when removed, in the new one when added. */
  line: number;
  text: string;
  /** Lines with the same run sit between the same unchanged lines, i.e. were changed in place. */
  run: number;
}

export interface ChangedLines {
  /** In the diff's order, so lines that follow each other in a file follow each other here. */
  removed: ChangedLine[];
  added: ChangedLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NO_FILE = '/dev/null';

/** The removed and added lines of a unified diff as git writes it, like GitHub's `.diff` of a PR. */
export function parseUnifiedDiff(diff: string): ChangedLines {
  const removed: ChangedLine[] = [];
  const added: ChangedLine[] = [];
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let path = '';
  // Lines left in the current hunk on each side; outside a hunk both are 0
  let oldLeft = 0;
  let newLeft = 0;
  let oldLine = 0;
  let newLine = 0;
  let run = 0;

  for (const raw of diff.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (oldLeft > 0 || newLeft > 0) {
      const marker = line[0];
      const text = line.slice(1);
      if (marker === '-') {
        removed.push({ path, line: oldLine++, text, run });
        oldLeft--;
      } else if (marker === '+') {
        added.push({ path, line: newLine++, text, run });
        newLeft--;
      } else if (marker === ' ' || line === '') {
        // Some tools strip the space of empty unchanged lines
        oldLine++;
        newLine++;
        oldLeft--;
        newLeft--;
        run++;
      }
      // "\ No newline at end of file" belongs to the line before it
      continue;
    }

    if (line.startsWith('diff --git ')) {
      oldPath = newPath = null;
    } else if (line.startsWith('--- ')) {
      oldPath = headerPath(line.slice(4), 'a/');
    } else if (line.startsWith('+++ ')) {
      newPath = headerPath(line.slice(4), 'b/');
    } else {
      const hunk = HUNK_HEADER.exec(line);
      if (!hunk) continue;
      path = newPath ?? oldPath ?? '';
      oldLine = Number(hunk[1]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newLine = Number(hunk[3]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
      run++;
    }
  }
  return { removed, added };
}

/** The path in a `---` or `+++` line, or null for a file that doesn't exist on that side. */
function headerPath(value: string, prefix: string): string | null {
  // Paths with spaces may get a trailing tab
  const path = unquote(value.replace(/\t$/, ''));
  if (path === NO_FILE) return null;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/** Git quotes paths with unusual characters C-style, writing non-ASCII bytes as octal escapes. */
function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;

  const bytes: number[] = [];
  const body = value.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char !== '\\') {
      bytes.push(...new TextEncoder().encode(char));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else {
      const next = body[++i] ?? '';
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
