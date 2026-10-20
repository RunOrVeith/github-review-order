/** Top-left corner of the panel in viewport pixels. */
export interface PanelPosition {
  x: number;
  y: number;
}

// Shared by all PRs so the panel stays wherever it was last put
export const panelPosition = storage.defineItem<PanelPosition>('local:panelPosition');

/** Keeps a panel of the given size fully inside the viewport. */
export function clampToViewport(
  position: PanelPosition,
  size: { width: number; height: number },
  viewport = { width: window.innerWidth, height: window.innerHeight },
): PanelPosition {
  return {
    x: Math.round(Math.min(Math.max(0, position.x), Math.max(0, viewport.width - size.width))),
    y: Math.round(Math.min(Math.max(0, position.y), Math.max(0, viewport.height - size.height))),
  };
}
