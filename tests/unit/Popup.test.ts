import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import Popup from '@/entrypoints/popup/Popup.svelte';
import { UNRECOGNIZED_LAYOUT, type Diagnosis } from '@/utils/diagnosis';
import { loadSettings, SETTINGS } from '@/utils/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

const diagnosis: Diagnosis = {
  url: 'https://github.com/acme/repo/pull/1/changes',
  pr: 'acme/repo#1',
  conversation: {
    state: 'read',
    layout: 'overview',
    posts: 1,
    headSha: 'abcdef1234567890abcdef1234567890abcdef12',
    limitations: ['Comments load separately.'],
    review: { source: 'File order from the PR description', items: 3 },
  },
  tree: { files: 4, unreadable: false },
  viewed: { rendered: 2, embedded: 4 },
  panel: 'shown',
  problems: [],
  notes: ['Comments load separately.'],
};

function renderPopup(load: () => Promise<Diagnosis | null>) {
  const copy = vi.fn(async (_text: string) => {});
  const showPanel = vi.fn(async () => {});
  const close = vi.fn();
  render(Popup, { load, version: '1.3.0', copy, showPanel, close });
  return { copy, showPanel, close, user: userEvent.setup() };
}

test('shows what was found on the tab', async () => {
  renderPopup(async () => diagnosis);

  expect(await screen.findByText('No problems found.')).toBeVisible();
  expect(within(screen.getByRole('list', { name: 'Notes' })).getByText('Comments load separately.')).toBeVisible();
  const value = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent;
  expect(value('Conversation page')).toBe('overview layout');
  expect(value('Review order')).toBe('3 files, from the PR description');
  expect(value('Head commit')).toBe('abcdef1');
  expect(value('File tree')).toBe('4 files');
  expect(value('Viewed states')).toBe('2 on the page, 4 embedded');
});

test('lists the problems that keep the panel hidden', async () => {
  renderPopup(async () => ({
    ...diagnosis,
    conversation: { state: 'read', layout: null, posts: 0, headSha: null, limitations: [], review: null },
    panel: 'hidden',
    problems: [UNRECOGNIZED_LAYOUT],
    notes: [],
  }));

  const problems = await screen.findByRole('region', { name: 'Problems' });
  expect(within(problems).getByText(UNRECOGNIZED_LAYOUT)).toBeVisible();
  expect(screen.getByText('Conversation page', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Not recognised');
});

test('copies a report for bug reports', async () => {
  const { copy, user } = renderPopup(async () => diagnosis);

  await user.click(await screen.findByRole('button', { name: 'Copy report' }));

  expect(JSON.parse(copy.mock.calls[0]![0])).toMatchObject({
    version: '1.3.0',
    settings: { skipViewed: true, autoAdvance: true, showMovedLines: true, minMovedLines: 3 },
    ...diagnosis,
  });
  expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
});

test("says where it works on tabs it doesn't run on", async () => {
  renderPopup(() => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')));

  expect(await screen.findByText(/Open a pull request's changes tab/)).toBeVisible();
});

test('says what it shows off a changes tab', async () => {
  renderPopup(async () => ({ ...diagnosis, pr: null, conversation: null, tree: null, viewed: null, notes: ['Not here.'] }));

  expect(await screen.findByText('Not here.')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Problems' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copy report' })).toBeNull();
});

test.each([
  ['closed', 'Show panel'],
  ['minimized', 'Expand panel'],
] as const)('brings back a %s panel and closes', async (panel, label) => {
  const { showPanel, close, user } = renderPopup(async () => ({ ...diagnosis, panel }));

  await user.click(await screen.findByRole('button', { name: label }));

  expect(showPanel).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

test('has nothing to bring back while the panel shows, or without one', async () => {
  for (const panel of ['shown', 'hidden'] as const) {
    renderPopup(async () => ({ ...diagnosis, panel }));
    await screen.findAllByRole('button', { name: 'Copy report' });
    expect(screen.queryByRole('button', { name: /panel/ })).toBeNull();
  }
});

test('shows every setting with what it does, wherever it opens', async () => {
  renderPopup(async () => null);

  const settings = await screen.findByRole('region', { name: 'Settings' });
  // The stored values load first
  await within(settings).findAllByRole('checkbox');
  for (const { label, hint } of SETTINGS) {
    const toggle = within(settings).getByRole('checkbox', { name: label });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(hint);
  }
});

test('stores a setting as soon as it is toggled', async () => {
  await fakeBrowser.storage.local.set({ autoAdvance: false });
  const { user } = renderPopup(async () => diagnosis);

  const autoAdvance = await screen.findByRole('checkbox', { name: 'Auto-advance' });
  expect(autoAdvance).not.toBeChecked();
  await user.click(autoAdvance);
  await user.click(screen.getByRole('checkbox', { name: 'Show moved lines' }));

  expect(await loadSettings()).toMatchObject({ skipViewed: true, autoAdvance: true, showMovedLines: false });
});

test('sets the minimum lines for a move under its setting, only while that is on', async () => {
  const { user } = renderPopup(async () => diagnosis);

  const minimum = await screen.findByRole('spinbutton', { name: 'Minimum lines' });
  expect(minimum).toHaveValue(3);
  expect(minimum).toHaveAccessibleDescription(/How many lines moved code needs/);

  await user.tripleClick(minimum);
  await user.keyboard('5');
  await user.tab();
  expect((await loadSettings()).minMovedLines).toBe(5);

  // Out of range snaps to what's allowed
  await user.tripleClick(minimum);
  await user.keyboard('99');
  await user.tab();
  expect(minimum).toHaveValue(20);
  expect((await loadSettings()).minMovedLines).toBe(20);

  await user.click(screen.getByRole('checkbox', { name: 'Show moved lines' }));
  expect(minimum).toBeDisabled();
});
