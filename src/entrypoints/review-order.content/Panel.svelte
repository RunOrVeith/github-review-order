<script lang="ts">
  import { onMount } from 'svelte';
  import { clampToViewport, type PanelPosition } from '@/utils/panel-position';
  import type { ReviewItem } from '@/utils/review-order';

  interface Props {
    items: ReviewItem[];
    initialIndex: number;
    /** Where the user last dragged the panel; null keeps it in the bottom-right corner. */
    initialPosition?: PanelPosition | null;
    /** Scrolls to the item and resolves to whether its file was found on the page. */
    onNavigate: (index: number) => Promise<boolean> | boolean;
    onMove?: (position: PanelPosition) => void;
    onClose: () => void;
  }

  let { items, initialIndex, initialPosition = null, onNavigate, onMove, onClose }: Props = $props();

  // The panel owns the current step and position from here on; the initial props only seed them
  // svelte-ignore state_referenced_locally
  let index = $state(initialIndex);
  // svelte-ignore state_referenced_locally
  let position = $state(initialPosition);
  let missing = $state(false);
  const item = $derived(items[index]!);

  let panel: HTMLElement;
  // Offset from the panel's corner to the pointer while dragging
  let grab: { x: number; y: number } | null = $state(null);

  async function go(target: number) {
    index = target;
    missing = !(await onNavigate(target));
  }

  function clamp(p: PanelPosition) {
    const { width, height } = panel.getBoundingClientRect();
    return clampToViewport(p, { width, height });
  }

  function startDrag(event: PointerEvent) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;

    const rect = panel.getBoundingClientRect();
    grab = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function drag(event: PointerEvent) {
    if (!grab) return;
    position = clamp({ x: event.clientX - grab.x, y: event.clientY - grab.y });
  }

  function endDrag() {
    if (!grab) return;
    grab = null;
    if (position) onMove?.(position);
  }

  function keepInViewport() {
    // A position saved in a larger window could otherwise end up off-screen
    if (position) position = clamp(position);
  }

  onMount(() => {
    keepInViewport();
    void go(index);
  });
</script>

<svelte:window onresize={keepInViewport} />

<aside
  bind:this={panel}
  class="panel"
  class:dragging={grab}
  aria-label="Review order"
  style:left={position && `${position.x}px`}
  style:top={position && `${position.y}px`}
  style:right={position && 'auto'}
  style:bottom={position && 'auto'}
>
  <header
    role="group"
    aria-label="Drag to move"
    title="Drag to move"
    onpointerdown={startDrag}
    onpointermove={drag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
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
    <button onclick={() => go(index - 1)} disabled={index === 0}>Previous</button>
    <button onclick={() => go(index)}>Reset current</button>
    <button onclick={() => go(index + 1)} disabled={index === items.length - 1}>Next</button>
  </nav>
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
    right: 16px;
    bottom: 16px;
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
</style>
