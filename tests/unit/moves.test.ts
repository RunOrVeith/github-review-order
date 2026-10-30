import { expect, test } from 'vitest';
import { findMovedBlocks } from '@/utils/moves';
import type { ChangedLine } from '@/utils/unified-diff';

/** Consecutive lines of a file, starting at the given line, each changed in the given run. */
function lines(path: string, start: number, texts: string[], run = start): ChangedLine[] {
  return texts.map((text, i) => ({ path, line: start + i, text, run }));
}

const FUNCTION = [
  'function resolveRecipient(talent, target) {',
  '  const address = talent.contactDetails[target];',
  '  return address ?? null;',
  '}',
];

test('finds a block moved to another file', () => {
  const blocks = findMovedBlocks({
    removed: lines('src/old.ts', 10, FUNCTION, 1),
    added: lines('src/new.ts', 40, FUNCTION, 2),
  });

  expect(blocks).toEqual([
    { from: { path: 'src/old.ts', start: 10, end: 13 }, to: { path: 'src/new.ts', start: 40, end: 43 }, inPlace: false },
  ]);
});

test('ignores whitespace, so re-indented moves count too', () => {
  const reindented = FUNCTION.map((line) => `    ${line.replace(/ {2}/g, '\t')}`);
  const blocks = findMovedBlocks({
    removed: lines('src/a.py', 5, FUNCTION, 1),
    added: lines('src/a.py', 80, reindented, 7),
  });

  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.inPlace).toBe(false);
});

test('marks lines re-indented where they were as in place, even a single one', () => {
  const blocks = findMovedBlocks({
    removed: lines('src/a.py', 5, ['result = compute_everything(inputs)'], 3),
    added: lines('src/a.py', 5, ['    result = compute_everything(inputs)'], 3),
  });

  expect(blocks).toEqual([
    { from: { path: 'src/a.py', start: 5, end: 5 }, to: { path: 'src/a.py', start: 5, end: 5 }, inPlace: true },
  ]);
});

test('skips matches of fewer than three lines elsewhere, which are mostly common lines', () => {
  const imports = ['from divemate.messaging.outreach import errors', 'from divemate.messaging import service'];
  expect(findMovedBlocks({ removed: lines('a.py', 1, imports, 1), added: lines('b.py', 1, imports, 2) })).toEqual([]);
});

test('skips blocks with too little text to tell, like closing brackets', () => {
  const brackets = ['  }', '  });', '}'];
  expect(findMovedBlocks({ removed: lines('a.ts', 1, brackets, 1), added: lines('b.ts', 9, brackets, 2) })).toEqual([]);
});

test('a block ends where the lines stop following each other', () => {
  // Line 12 isn't removed, so the removed lines are two separate stretches
  const removed = [...lines('a.ts', 10, FUNCTION.slice(0, 2), 1), ...lines('a.ts', 13, FUNCTION.slice(2), 2)];
  const added = lines('b.ts', 1, FUNCTION, 3);

  expect(findMovedBlocks({ removed, added })).toEqual([]);
});

test('prefers the longest match and uses each added line once', () => {
  const short = FUNCTION.slice(0, 3);
  const removed = [...lines('a.ts', 1, FUNCTION, 1), ...lines('a.ts', 20, short, 2)];
  const added = [...lines('b.ts', 1, short, 3), ...lines('c.ts', 1, FUNCTION, 4)];

  expect(findMovedBlocks({ removed, added }).map((block) => [block.from.start, block.to.path, block.to.start])).toEqual([
    [1, 'c.ts', 1],
    [20, 'b.ts', 1],
  ]);
});

test('splits a moved block where its lines were edited, keeping the unchanged parts', () => {
  const body = [
    'const connection = await repository.connectionFor(account);',
    'if (!connection.isActive) throw new InactiveConnectionError();',
    'const message = template.render(talent);',
  ];
  const tail = ['await client.send(connection, message);', 'await bookkeeping.record(message);', 'return message.id;'];
  const removed = lines('a.ts', 1, [...body, 'const unused = legacyLookup(account);', ...tail], 1);
  const added = lines('b.ts', 1, [...body, 'const tracked = tracker.start(account);', ...tail], 2);

  expect(findMovedBlocks({ removed, added }).map((block) => [block.from.start, block.from.end])).toEqual([
    [1, 3],
    [5, 7],
  ]);
});
