import { describe, expect, test } from 'vitest';
import { anchorPanel, clampToViewport, placePanel } from '@/utils/panel-position';

const size = { width: 300, height: 100 };
const viewport = { width: 1000, height: 800 };

describe('clampToViewport', () => {
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
});

describe('anchorPanel', () => {
  test('anchors to the top-left edges in the top-left quarter', () => {
    expect(anchorPanel({ x: 40, y: 60 }, size, viewport)).toEqual({
      horizontal: { edge: 'left', offset: 40 },
      vertical: { edge: 'top', offset: 60 },
    });
  });

  test('anchors to the bottom-right edges in the bottom-right quarter', () => {
    expect(anchorPanel({ x: 680, y: 690 }, size, viewport)).toEqual({
      horizontal: { edge: 'right', offset: 20 },
      vertical: { edge: 'bottom', offset: 10 },
    });
  });
});

describe('placePanel', () => {
  const bottomRight = anchorPanel({ x: 680, y: 690 }, size, viewport);

  test('round-trips with anchorPanel', () => {
    expect(placePanel(bottomRight, size, viewport)).toEqual({ x: 680, y: 690 });
  });

  test('grows a bottom-anchored panel upward', () => {
    expect(placePanel(bottomRight, { width: 300, height: 250 }, viewport)).toEqual({ x: 680, y: 540 });
  });

  test('keeps its corner when the viewport is resized', () => {
    expect(placePanel(bottomRight, size, { width: 1600, height: 1000 })).toEqual({ x: 1280, y: 890 });
  });

  test('stays inside a viewport that got too small without forgetting the position', () => {
    const topLeft = anchorPanel({ x: 100, y: 300 }, size, viewport);
    expect(placePanel(topLeft, size, { width: 500, height: 350 })).toEqual({ x: 100, y: 250 });
    expect(placePanel(topLeft, size, viewport)).toEqual({ x: 100, y: 300 });
  });
});
