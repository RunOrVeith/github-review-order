<script lang="ts">
  import { onMount } from 'svelte';
  import type { ReviewItem } from '@/utils/review-order';

  interface Props {
    items: ReviewItem[];
    initialIndex: number;
    /** Scrolls to the item and resolves to whether its file was found on the page. */
    onNavigate: (index: number) => Promise<boolean> | boolean;
    onClose: () => void;
  }

  let { items, initialIndex, onNavigate, onClose }: Props = $props();

  // The panel owns the current step from here on; initialIndex only seeds it
  // svelte-ignore state_referenced_locally
  let index = $state(initialIndex);
  let missing = $state(false);
  const item = $derived(items[index]!);

  async function go(target: number) {
    index = target;
    missing = !(await onNavigate(target));
  }

  onMount(() => {
    void go(index);
  });
</script>

<aside class="panel" aria-label="Review order">
  <header>
    <span class="step">{index + 1} / {items.length}</span>
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
