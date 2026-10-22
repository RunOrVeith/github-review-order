export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Where the user put the panel, as distances from the viewport edges closest to
 * it. A panel parked at the bottom therefore grows upward, and one in a corner
 * stays there when the window is resized.
 */
export interface PanelPosition {
  horizontal: { edge: 'left' | 'right'; offset: number };
  vertical: { edge: 'top' | 'bottom'; offset: number };
}

export const DEFAULT_PANEL_POSITION: PanelPosition = {
  horizontal: { edge: 'right', offset: 16 },
  vertical: { edge: 'bottom', offset: 16 },
};

// Shared by all PRs so the panel stays wherever it was last put
export const panelPosition = storage.defineItem<PanelPosition>('local:panelAnchor');

/** Whether the panel is shrunk to its step and arrows; shared by all PRs like its position. */
export const panelMinimized = storage.defineItem<boolean>('local:panelMinimized', { fallback: false });

/** Where the panel was last put, if anywhere. A position that can't be read, e.g. from an older version, is removed. */
export async function loadPanelPosition(): Promise<PanelPosition | null> {
  const saved: unknown = await panelPosition.getValue();
  if (saved === null || isPanelPosition(saved)) return saved;

  await panelPosition.removeValue();
  return null;
}

export function isPanelPosition(value: unknown): value is PanelPosition {
  if (typeof value !== 'object' || value === null) return false;
  const { horizontal, vertical } = value as Record<string, unknown>;
  return isEdgeOffset(horizontal, ['left', 'right']) && isEdgeOffset(vertical, ['top', 'bottom']);
}

function isEdgeOffset(value: unknown, edges: string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { edge, offset } = value as Record<string, unknown>;
  return typeof edge === 'string' && edges.includes(edge) && typeof offset === 'number' && Number.isFinite(offset);
}

/** Moves a panel of the given size so it's fully inside the viewport. */
export function clampToViewport(point: Point, size: Size, viewport: Size): Point {
  return {
    x: Math.round(Math.min(Math.max(0, point.x), Math.max(0, viewport.width - size.width))),
    y: Math.round(Math.min(Math.max(0, point.y), Math.max(0, viewport.height - size.height))),
  };
}

/** The panel's top-left corner for its current size, kept fully inside the viewport. */
export function placePanel(position: PanelPosition, size: Size, viewport: Size): Point {
  const { horizontal, vertical } = position;
  const x = horizontal.edge === 'left' ? horizontal.offset : viewport.width - size.width - horizontal.offset;
  const y = vertical.edge === 'top' ? vertical.offset : viewport.height - size.height - vertical.offset;
  return clampToViewport({ x, y }, size, viewport);
}

/** Anchors a panel at the given top-left corner to the viewport edges closest to its center. */
export function anchorPanel(point: Point, size: Size, viewport: Size): PanelPosition {
  const right = point.x + size.width / 2 > viewport.width / 2;
  const bottom = point.y + size.height / 2 > viewport.height / 2;

  return {
    horizontal: right
      ? { edge: 'right', offset: viewport.width - size.width - point.x }
      : { edge: 'left', offset: point.x },
    vertical: bottom
      ? { edge: 'bottom', offset: viewport.height - size.height - point.y }
      : { edge: 'top', offset: point.y },
  };
}
