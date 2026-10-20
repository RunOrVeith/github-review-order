<script lang="ts">
  import { onMount } from 'svelte';
  import {
    anchorPanel,
    clampToViewport,
    DEFAULT_PANEL_POSITION,
    placePanel,
    type PanelPosition,
    type Point,
    type Size,
  } from '@/utils/panel-position';
  import { findStep } from '@/utils/navigation';
  import type { ReviewItem } from '@/utils/review-order';

  interface Props {
    items: ReviewItem[];
    initialIndex: number;
    /** Where the user last dragged the panel; null keeps it in the bottom-right corner. */
    initialPosition?: PanelPosition | null;
    initialSkipViewed?: boolean;
    /** Whether a step's file is ticked as viewed on the page. */
    isViewed?: (index: number) => boolean;
    /** Calls back whenever files get ticked or unticked; returns a function that stops it. */
    watchViewed?: (onChange: () => void) => () => void;
    /** Scrolls to the item and resolves to whether its file was found on the page. */
    onNavigate: (index: number) => Promise<boolean> | boolean;
    onMove?: (position: PanelPosition) => void;
    onSkipViewedChange?: (skip: boolean) => void;
    onClose: () => void;
  }

  let {
    items,
    initialIndex,
    initialPosition = null,
    initialSkipViewed = true,
    isViewed = () => false,
    watchViewed,
    onNavigate,
    onMove,
    onSkipViewedChange,
    onClose,
  }: Props = $props();

  // The panel owns the current step, position and toggle from here on; the initial props only seed them
  // svelte-ignore state_referenced_locally
  let index = $state(initialIndex);
  // svelte-ignore state_referenced_locally
  let position = $state(initialPosition ?? DEFAULT_PANEL_POSITION);
  // svelte-ignore state_referenced_locally
  let skipViewed = $state(initialSkipViewed);
  let missing = $state(false);
  const item = $derived(items[index]!);

  // Viewed states live on GitHub's page, so changes there arrive through watchViewed
  let viewedVersion = $state(0);
  const skip = (step: number) => skipViewed && isViewed(step);
  const previous = $derived.by(() => {
    void viewedVersion;
    return findStep(index, -1, items.length, skip);
  });
  const next = $derived.by(() => {
    void viewedVersion;
    return findStep(index, 1, items.length, skip);
  });

  let panel: HTMLElement;
  let size = $state<Size>({ width: 0, height: 0 });
  let viewport = $state(measureViewport());
  // While dragging: where the pointer grabbed the panel, its size then, and where it's been dragged to
  let drag = $state<{ grab: Point; size: Size; point: Point | null } | null>(null);

  // Derived instead of stored, so clamping to a small window never overwrites where the user put it
  const placed = $derived(drag?.point ?? placePanel(position, size, viewport));

  async function go(target: number) {
    index = target;
    missing = !(await onNavigate(target));
  }

  function measureViewport(): Size {
    // Unlike innerWidth/innerHeight these exclude scrollbars, which fixed elements can't be drawn under
    const { clientWidth, clientHeight } = document.documentElement;
    return { width: clientWidth, height: clientHeight };
  }

  function measureSize() {
    const rect = panel.getBoundingClientRect();
    size = { width: rect.width, height: rect.height };
  }

  function startDrag(event: PointerEvent) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;

    const rect = panel.getBoundingClientRect();
    drag = {
      grab: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      size: { width: rect.width, height: rect.height },
      point: null,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent) {
    if (!drag) return;
    // The button was released without the header getting a pointerup
    if (event.buttons === 0) return endDrag();

    drag.point = clampToViewport(
      { x: event.clientX - drag.grab.x, y: event.clientY - drag.grab.y },
      drag.size,
      viewport,
    );
  }

  function endDrag() {
    if (!drag) return;
    const { point, size: draggedSize } = drag;
    drag = null;
    // Plain clicks on the header don't move the panel
    if (!point) return;

    position = anchorPanel(point, draggedSize, viewport);
    onMove?.(position);
  }

  function toggleSkipViewed(event: Event) {
    skipViewed = (event.currentTarget as HTMLInputElement).checked;
    onSkipViewedChange?.(skipViewed);
  }

  /** Explains a disabled button when skipping is what disabled it. */
  function allViewedHint(target: number | null, end: boolean, direction: string) {
    return target === null && skipViewed && !end ? `All files ${direction} are viewed` : undefined;
  }

  onMount(() => {
    measureSize();
    // Keeps the panel inside the viewport when its content changes height
    const observer = new ResizeObserver(measureSize);
    observer.observe(panel);
    const unwatch = watchViewed?.(() => viewedVersion++);
    void go(index);
    return () => {
      observer.disconnect();
      unwatch?.();
    };
  });
</script>

<svelte:window onresize={() => (viewport = measureViewport())} />

<aside
  bind:this={panel}
  class="panel"
  class:dragging={drag}
  aria-label="Review order"
  style:left={`${placed.x}px`}
  style:top={`${placed.y}px`}
>
  <header
    role="group"
    aria-label="Drag to move"
    title="Drag to move"
    onpointerdown={startDrag}
    onpointermove={moveDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onlostpointercapture={endDrag}
  >
    <span class="step"><span class="grip" aria-hidden="true">⠿</span> {index + 1} / {items.length}</span>
    <button class="close" aria-label="Close" onclick={onClose}>✕</button>
  </header>

  <code class="path">{item.path}</code>
  {#if item.description}
    <p class="description">{item.description}</p>
  {/if}
  {#if missing}
    <p class="missing">File not found in this PR</p>
  {/if}

  <nav>
    <button
      onclick={() => previous !== null && go(previous)}
      disabled={previous === null}
      title={allViewedHint(previous, index === 0, 'before this one')}
    >
      Previous
    </button>
    <button onclick={() => go(index)}>Reset current</button>
    <button
      onclick={() => next !== null && go(next)}
      disabled={next === null}
      title={allViewedHint(next, index === items.length - 1, 'after this one')}
    >
      Next
    </button>
  </nav>

  <label class="skip-viewed">
    <input type="checkbox" checked={skipViewed} onchange={toggleSkipViewed} />
    Skip viewed
  </label>
</aside>

<style>
  .panel {
    --bg: #ffffff;
    --fg: #1f2328;
    --muted: #59636e;
    --border: #d1d9e0;
    --button: #f6f8fa;
    --warning: #9a6700;

    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    width: min(340px, calc(100vw - 32px));
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    .panel {
      --bg: #151b23;
      --fg: #f0f6fc;
      --muted: #9198a1;
      --border: #3d444d;
      --button: #212830;
      --warning: #d29922;
    }
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: -12px -12px 0;
    padding: 8px 12px 0;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .dragging,
  .dragging header {
    cursor: grabbing;
  }

  .grip {
    margin-right: 2px;
  }

  .step {
    color: var(--muted);
    font-size: 12px;
  }

  .path {
    display: block;
    margin-top: 4px;
    font: 600 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow-wrap: anywhere;
  }

  .description,
  .missing {
    margin: 6px 0 0;
  }

  .missing {
    color: var(--warning);
    font-size: 12px;
  }

  nav {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }

  button {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--button);
    color: inherit;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  nav button {
    flex: 1;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .close {
    padding: 0 6px;
    border: none;
    background: none;
    color: var(--muted);
  }

  .skip-viewed {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }

  .skip-viewed input {
    margin: 0;
    accent-color: var(--bgColor-accent-emphasis, #0969da);
  }
</style>
