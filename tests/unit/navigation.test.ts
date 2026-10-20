import { expect, test } from 'vitest';
import { findStep } from '@/utils/navigation';

const none = () => false;

test('steps to the neighbour when nothing is skipped', () => {
  expect(findStep(2, 1, 5, none)).toBe(3);
  expect(findStep(2, -1, 5, none)).toBe(1);
});

test('jumps over skipped steps in either direction', () => {
  const skipped = new Set([1, 2, 4]);
  const skip = (index: number) => skipped.has(index);

  expect(findStep(0, 1, 6, skip)).toBe(3);
  expect(findStep(3, 1, 6, skip)).toBe(5);
  expect(findStep(5, -1, 6, skip)).toBe(3);
  expect(findStep(3, -1, 6, skip)).toBe(0);
});

test('returns null at the ends and when everything left is skipped', () => {
  expect(findStep(0, -1, 3, none)).toBeNull();
  expect(findStep(2, 1, 3, none)).toBeNull();
  expect(findStep(0, 1, 3, () => true)).toBeNull();
});
