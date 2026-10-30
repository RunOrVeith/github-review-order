import type { ChangedLine, ChangedLines } from './unified-diff';

/** Consecutive lines of one file, both ends included. */
export interface LineRange {
  path: string;
  start: number;
  end: number;
}

/** Lines a PR removes in one place and adds back in another, the same apart from whitespace. */
export interface MovedBlock {
  /** Where the lines were removed, in the old file. */
  from: LineRange;
  /** Where they were added, in the new file. */
  to: LineRange;
  /** Removed and added between the same unchanged lines, so they stayed put and only their indentation changed. */
  inPlace: boolean;
}

// Like git's --color-moved, a block needs this many letters and digits, so `}` and blank lines never count
const MIN_ALNUM = 20;
// Single lines matching somewhere else are mostly common imports and asserts, not moves
const MIN_MOVED_LINES = 3;
const ALNUM = /[\p{L}\p{N}]/gu;

/**
 * Finds blocks of removed lines that are added back elsewhere, ignoring
 * whitespace, like `git diff --color-moved --color-moved-ws=ignore-all-space`.
 * Each removed and added line is part of at most one block, and the longest
 * match wins.
 */
export function findMovedBlocks({ removed, added }: ChangedLines): MovedBlock[] {
  const removedText = removed.map((line) => normalize(line.text));
  const addedText = added.map((line) => normalize(line.text));
  // Blocks start at a line with some letters or digits, so they can't start at every `}`
  const addedByText = new Map<string, number[]>();
  addedText.forEach((text, index) => {
    if (!hasAlnum(text)) return;
    const indices = addedByText.get(text);
    if (indices) indices.push(index);
    else addedByText.set(text, [index]);
  });

  const taken = new Uint8Array(added.length);
  const blocks: MovedBlock[] = [];
  for (let i = 0; i < removed.length; ) {
    let best: { j: number; length: number; inPlace: boolean } | null = null;
    for (const j of addedByText.get(removedText[i]!) ?? []) {
      if (taken[j]) continue;
      let length = 1;
      while (
        follows(removed, i + length) &&
        follows(added, j + length) &&
        !taken[j + length] &&
        removedText[i + length] === addedText[j + length]
      ) {
        length++;
      }
      const inPlace = removed[i]!.run === added[j]!.run;
      if (!best || length > best.length || (length === best.length && inPlace && !best.inPlace)) {
        best = { j, length, inPlace };
      }
    }

    if (best && counts(removedText.slice(i, i + best.length), best.inPlace)) {
      const { j, length, inPlace } = best;
      blocks.push({ from: range(removed, i, length), to: range(added, j, length), inPlace });
      taken.fill(1, j, j + length);
      i += length;
    } else {
      i++;
    }
  }
  return blocks;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '');
}

function hasAlnum(text: string): boolean {
  return text.search(ALNUM) !== -1;
}

/** Whether a block is big enough to be a move rather than lines that happen to be alike. */
function counts(texts: string[], inPlace: boolean): boolean {
  // Re-indenting in place is clear even for a single line
  if (!inPlace && texts.length < MIN_MOVED_LINES) return false;
  return texts.reduce((sum, text) => sum + (text.match(ALNUM)?.length ?? 0), 0) >= MIN_ALNUM;
}

/** Whether the line at the index comes right after the one before it in the same file. */
function follows(lines: ChangedLine[], index: number): boolean {
  const line = lines[index];
  const previous = lines[index - 1];
  return line !== undefined && previous !== undefined && line.path === previous.path && line.line === previous.line + 1;
}

function range(lines: ChangedLine[], start: number, length: number): LineRange {
  const first = lines[start]!;
  return { path: first.path, start: first.line, end: first.line + length - 1 };
}
