<script lang="ts">
  import { onMount } from 'svelte';
  import { createSubscriber } from 'svelte/reactivity';
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
  import type { PanelStatus } from './status.svelte';

  interface Props {
    /** Empty when the review order section lists no files; a notice then says why. */
    items: ReviewItem[];
    initialIndex: number;
    /** Where the user last dragged the panel; null keeps it in the bottom-right corner. */
    initialPosition?: PanelPosition | null;
    initialSkipViewed?: boolean;
    /** Whether the panel starts as just the step and its arrows. */
    initialMinimized?: boolean;
    status?: PanelStatus;
    /** Whether a step's file is ticked as viewed on the page. */
    isViewed?: (index: number) => boolean;
    /** Calls back whenever files get ticked or unticked; returns a function that stops it. */
    watchViewed?: (onChange: () => void) => () => void;
    /** Scrolls to the item and resolves to whether its file was found on the page. */
    onNavigate: (index: number) => Promise<boolean> | boolean;
    onMove?: (position: PanelPosition) => void;
    onSkipViewedChange?: (skip: boolean) => void;
    onMinimizedChange?: (minimized: boolean) => void;
    onClose: () => void;
  }

  let {
    items,
    initialIndex,
    initialPosition = null,
    initialSkipViewed = true,
    initialMinimized = false,
    status,
    isViewed = () => false,
    watchViewed,
    onNavigate,
    onMove,
    onSkipViewedChange,
    onMinimizedChange,
    onClose,
  }: Props = $props();

  // The panel owns the current step, position and toggles from here on; the initial props only seed them
  // svelte-ignore state_referenced_locally
  let index = $state(initialIndex);
  // svelte-ignore state_referenced_locally
  let position = $state(initialPosition ?? DEFAULT_PANEL_POSITION);
  // svelte-ignore state_referenced_locally
  let skipViewed = $state(initialSkipViewed);
  // svelte-ignore state_referenced_locally
  let minimized = $state(initialMinimized);
  let missing = $state(false);
  const item = $derived(items[index]);

  // Viewed states live on GitHub's page; reading them listens for their changes while anything shows them
  const subscribeViewed = createSubscriber((update) => watchViewed?.(update));
  function skip(step: number) {
    subscribeViewed();
    return skipViewed && isViewed(step);
  }
  const previous = $derived(findStep(index, -1, items.length, skip));
  const next = $derived(findStep(index, 1, items.length, skip));

  let panel: HTMLElement;
  let size = $state<Size>({ width: 0, height: 0 });
  let viewport = $state(measureViewport());
  // While dragging: where the pointer grabbed the panel, its size then, and where it's been dragged to
  let drag = $state<{ grab: Point; size: Size; point: Point | null } | null>(null);

  // Derived instead of stored, so clamping to a small window never overwrites where the user put it
  const placed = $derived(drag?.point ?? placePanel(position, size, viewport));

  async function go(target: number) {
    index = target;
    const found = await onNavigate(target);
    // Another step may have been picked while this one was loading
    if (index === target) missing = !found;
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
    // The header is the drag handle, but its controls stay clickable
    if (event.button !== 0 || (event.target as Element).closest('a, button, label')) return;

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

  function toggleMinimized(event: MouseEvent) {
    // Double-clicking a control, like stepping quickly with Next, isn't meant for the panel
    if ((event.target as Element).closest('a, button, label, input')) return;
    minimized = !minimized;
    // A double-click also selects the word under the pointer
    getSelection()?.removeAllRanges();
    onMinimizedChange?.(minimized);
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
    if (item) void go(index);
    return () => observer.disconnect();
  });
</script>

<svelte:window onresize={() => (viewport = measureViewport())} />

{#snippet previousButton()}
  <button
    class="arrow"
    aria-label="Previous"
    onclick={() => previous !== null && go(previous)}
    disabled={previous === null}
    title={allViewedHint(previous, index === 0, 'before this one') ?? 'Previous file'}
  >
    ←
  </button>
{/snippet}

{#snippet nextButton()}
  <button
    class="arrow"
    aria-label="Next"
    onclick={() => next !== null && go(next)}
    disabled={next === null}
    title={allViewedHint(next, index === items.length - 1, 'after this one') ?? 'Next file'}
  >
    →
  </button>
{/snippet}

<aside
  bind:this={panel}
  class={['panel', { dragging: drag, minimized }]}
  aria-label="Review order"
  style:left={`${placed.x}px`}
  style:top={`${placed.y}px`}
  ondblclick={toggleMinimized}
>
  <header
    role="group"
    aria-label="Drag to move"
    title={minimized ? 'Drag to move, double-click to expand' : 'Drag to move, double-click to minimize'}
    onpointerdown={startDrag}
    onpointermove={moveDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onlostpointercapture={endDrag}
  >
    <span class="status">
      <span class="step">
        <span class="grip" aria-hidden="true">⠿</span>
        {#if item}{index + 1} / {items.length}{:else}Review order{/if}
      </span>
      {#if item && !minimized}
        <label class="skip-viewed">
          <input type="checkbox" checked={skipViewed} onchange={toggleSkipViewed} />
          Skip viewed
        </label>
      {/if}
    </span>
    {#if minimized}
      {#if item}
        <span class="arrows">
          {@render previousButton()}
          {@render nextButton()}
        </span>
      {/if}
    {:else}
      <span class="actions">
        {#if status?.source}
          <!-- The empty title keeps the header's own title from showing over this tooltip -->
          <span class="source" title="">
            <a
              href={status.source.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Where this order is from"
              aria-describedby="review-order-source"
            >
              ?
            </a>
            <span id="review-order-source" class="tooltip" role="tooltip">{status.source.text}</span>
          </span>
        {/if}
        <button class="close" aria-label="Close" onclick={onClose}>✕</button>
      </span>
    {/if}
  </header>

  <!-- Minimized, the header with the step and its arrows is all there is -->
  {#if !minimized}
    {#if item}
      <code class="path">{item.path}</code>
      {#if item.description}
        <p class="description">{item.description}</p>
      {/if}
      {#if missing}
        <p class="warning">File not found in this PR</p>
      {/if}
    {/if}
    {#if status?.reviewProblem}
      <p class="warning" role="status">{status.reviewProblem}</p>
    {/if}
    {#if status?.treeProblem}
      <p class="warning" role="status">{status.treeProblem}</p>
    {/if}

    {#if item}
      <nav>
        {@render previousButton()}
        <button class="reset" onclick={() => go(index)}>Reset current</button>
        {@render nextButton()}
      </nav>
    {/if}
  {/if}
</aside>

<style>
  .panel {
    /* GitHub's Primer tokens reach into the shadow root and follow the theme picked in GitHub's settings */
    --bg: var(--overlay-bgColor, var(--fallback-bg));
    --fg: var(--fgColor-default, var(--fallback-fg));
    --muted: var(--fgColor-muted, var(--fallback-muted));
    --border: var(--borderColor-default, var(--fallback-border));
    --button: var(--button-default-bgColor-rest, var(--fallback-button));
    --warning: var(--fgColor-attention, var(--fallback-warning));
    --accent: var(--bgColor-accent-emphasis, var(--fallback-accent));
    --link: var(--fgColor-accent, var(--fallback-link));
    --tooltip-bg: var(--tooltip-bgColor, var(--fallback-tooltip-bg));
    --tooltip-fg: var(--tooltip-fgColor, #ffffff);
    --shadow: var(--shadow-floating-small, 0 8px 24px rgb(0 0 0 / 0.15));
    --font: var(--fontStack-system, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif);
    --font-mono: var(--fontStack-monospace, ui-monospace, SFMono-Regular, Menlo, monospace);

    /* Only used if GitHub stops defining its tokens, when the system's color scheme is the best guess */
    --fallback-bg: #ffffff;
    --fallback-fg: #1f2328;
    --fallback-muted: #59636e;
    --fallback-border: #d1d9e0;
    --fallback-button: #f6f8fa;
    --fallback-warning: #9a6700;
    --fallback-accent: #0969da;
    --fallback-link: #0969da;
    --fallback-tooltip-bg: #25292e;

    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    width: min(340px, calc(100vw - 32px));
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    box-shadow: var(--shadow);
    font: 14px/1.5 var(--font);
  }

  @media (prefers-color-scheme: dark) {
    .panel {
      --fallback-bg: #151b23;
      --fallback-fg: #f0f6fc;
      --fallback-muted: #9198a1;
      --fallback-border: #3d444d;
      --fallback-button: #212830;
      --fallback-warning: #d29922;
      --fallback-accent: #1f6feb;
      --fallback-link: #4493f8;
      --fallback-tooltip-bg: #3d444d;
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

  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .source {
    position: relative;
    display: flex;
  }

  .source a {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 16px;
    height: 16px;
    border: 1px solid currentColor;
    border-radius: 50%;
    color: var(--muted);
    font: 600 11px/1 var(--font);
    text-decoration: none;
    cursor: pointer;
  }

  .source a:hover,
  .source a:focus-visible {
    color: var(--link);
  }

  /* Below the icon, inside the panel, which is always fully on screen */
  .tooltip {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 1;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--tooltip-bg);
    color: var(--tooltip-fg);
    font-size: 12px;
    line-height: 1.4;
    white-space: nowrap;
    pointer-events: none;
    visibility: hidden;
  }

  .source:hover .tooltip,
  .source a:focus-visible + .tooltip {
    visibility: visible;
  }

  .path {
    display: block;
    margin-top: 4px;
    font: 600 13px/1.4 var(--font-mono);
    overflow-wrap: anywhere;
  }

  .description,
  .warning {
    margin: 6px 0 0;
  }

  .warning {
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

  nav .reset {
    flex: 1;
  }

  .arrow {
    padding: 2px 10px;
    font-size: 14px;
    line-height: 18px;
  }

  .arrows {
    display: flex;
    gap: 4px;
  }

  /* Just the header: the step and its arrows, sized to fit them */
  .minimized {
    width: auto;
    padding: 6px 8px;
  }

  .minimized header {
    gap: 12px;
    margin: -6px -8px;
    padding: 6px 8px;
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

  .status {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .skip-viewed {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
  }

  .skip-viewed input {
    margin: 0;
    accent-color: var(--accent);
  }
</style>
