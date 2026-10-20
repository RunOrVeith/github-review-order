import { expect, test } from 'vitest';
import { clampToViewport } from '@/utils/panel-position';

const size = { width: 300, height: 100 };
const viewport = { width: 1000, height: 800 };

test('keeps positions inside the viewport', () => {
  expect(clampToViewport({ x: 200, y: 300 }, size, viewport)).toEqual({ x: 200, y: 300 });
});

test('pulls the panel back from every edge', () => {
  expect(clampToViewport({ x: -50, y: -10 }, size, viewport)).toEqual({ x: 0, y: 0 });
  expect(clampToViewport({ x: 900, y: 790 }, size, viewport)).toEqual({ x: 700, y: 700 });
});

test('sticks to the top-left corner when the viewport is smaller than the panel', () => {
  expect(clampToViewport({ x: 50, y: 50 }, size, { width: 200, height: 50 })).toEqual({ x: 0, y: 0 });
});
