<script lang="ts">
  import type { ConversationState, Diagnosis } from '@/utils/diagnosis';
  import { loadSettings } from '@/utils/settings';
  import SettingsSection from './SettingsSection.svelte';

  interface Props {
    /** The active tab's diagnosis, or null when the tab has no content script, e.g. off github.com. */
    load: () => Promise<Diagnosis | null>;
    /** The extension's version, for bug reports. */
    version: string;
    /** Brings back the tab's closed or minimized panel. */
    showPanel: () => Promise<void>;
    copy?: (text: string) => Promise<void>;
    /** Closes the popup, so the panel it brought back isn't behind it. */
    close?: () => void;
  }

  let {
    load,
    version,
    showPanel,
    copy = (text) => navigator.clipboard.writeText(text),
    close = () => window.close(),
  }: Props = $props();

  let copied = $state(false);
  // The popup is rebuilt every time it opens, so the tab is only asked once
  // svelte-ignore state_referenced_locally
  const diagnosis = load().catch(() => null);

  function describeConversation(conversation: ConversationState | null): string {
    if (conversation === null) return '–';
    if (conversation.state === 'loading') return 'Loading…';
    if (conversation.state === 'failed') return "Couldn't load it";
    return conversation.layout === null ? 'Not recognised' : `${conversation.layout} layout`;
  }

  function describeReview(conversation: ConversationState | null): string {
    if (conversation?.state !== 'read' || conversation.layout === null) return '–';
    const review = conversation.review;
    if (!review) return 'None';
    return `${review.items} ${review.items === 1 ? 'file' : 'files'}, ${review.source.replace(/^File order from /, 'from ')}`;
  }

  function details(d: Diagnosis): [string, string][] {
    const conversation = d.conversation;
    const read = conversation?.state === 'read' ? conversation : null;
    return [
      ['Pull request', d.pr ?? '–'],
      ['Conversation page', describeConversation(conversation)],
      ['Posts read', read?.layout ? String(read.posts) : '–'],
      ['Review order', describeReview(conversation)],
      ['Head commit', read?.headSha?.slice(0, 7) ?? '–'],
      ['File tree', d.tree ? (d.tree.unreadable ? 'Unreadable' : `${d.tree.files} files`) : '–'],
      [
        'Viewed states',
        d.viewed ? `${d.viewed.rendered} on the page, ${d.viewed.embedded ?? 'none'} embedded` : '–',
      ],
      ['Panel', d.panel],
    ];
  }

  async function bringBackPanel() {
    await showPanel();
    close();
  }

  async function copyReport(d: Diagnosis) {
    const settings = await loadSettings();
    await copy(JSON.stringify({ version, userAgent: navigator.userAgent, settings, ...d }, null, 2));
    copied = true;
  }
</script>

<main>
  <h1>Review order</h1>
  <SettingsSection />
  <section class="tab" aria-labelledby="tab-heading">
    <h2 id="tab-heading">This tab</h2>
    {#await diagnosis}
      <p class="muted">Checking this tab…</p>
    {:then d}
      {#if d === null}
        <p class="muted">
          Open a pull request's changes tab on github.com to see how its review order is read. If one is open, reload it.
        </p>
      {:else}
        {#if d.pr !== null}
          <section aria-label="Problems">
            {#if d.problems.length > 0}
              <ul class="problems">
                {#each d.problems as problem (problem)}
                  <li>{problem}</li>
                {/each}
              </ul>
            {:else}
              <p class="ok">No problems found.</p>
            {/if}
          </section>
        {/if}
        {#if d.notes.length > 0}
          <ul class="notes" aria-label="Notes">
            {#each d.notes as note (note)}
              <li>{note}</li>
            {/each}
          </ul>
        {/if}
        {#if d.pr !== null}
          <dl>
            {#each details(d) as [term, value] (term)}
              <dt>{term}</dt>
              <dd>{value}</dd>
            {/each}
          </dl>
          <div class="actions">
            {#if d.panel === 'closed' || d.panel === 'minimized'}
              <button type="button" class="primary" onclick={bringBackPanel}>
                {d.panel === 'closed' ? 'Show panel' : 'Expand panel'}
              </button>
            {/if}
            <button type="button" onclick={() => copyReport(d)}>{copied ? 'Copied' : 'Copy report'}</button>
          </div>
        {/if}
      {/if}
    {/await}
  </section>
</main>

<style>
  :global(:root) {
    --bg: #ffffff;
    --fg: #1f2328;
    --muted: #59636e;
    --border: #d1d9e0;
    --button: #f6f8fa;
    --warning: #9a6700;
    --warning-bg: #fff8c5;
    --success: #1a7f37;
    --accent: #1f883d;
    --accent-fg: #ffffff;
    color-scheme: light dark;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #0d1117;
      --fg: #f0f6fc;
      --muted: #9198a1;
      --border: #3d444d;
      --button: #212830;
      --warning: #d29922;
      --warning-bg: #bb800926;
      --success: #3fb950;
      --accent: #238636;
      --accent-fg: #ffffff;
    }
  }

  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
  }

  main {
    width: 340px;
    padding: 12px 14px 14px;
  }

  h1 {
    margin: 0 0 10px;
    font-size: 14px;
  }

  .tab {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }

  .tab h2 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  p {
    margin: 0 0 8px;
  }

  ul {
    margin: 0 0 10px;
    padding: 0;
    list-style: none;
  }

  li + li {
    margin-top: 6px;
  }

  .problems li {
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--warning-bg);
    color: var(--warning);
  }

  .notes,
  .muted {
    color: var(--muted);
  }

  .ok {
    color: var(--success);
  }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 12px;
    margin: 0 0 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  button {
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--button);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  button.primary {
    border-color: transparent;
    background: var(--accent);
    color: var(--accent-fg);
  }
</style>
