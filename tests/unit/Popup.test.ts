import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import Popup from '@/entrypoints/popup/Popup.svelte';
import { UNRECOGNIZED_LAYOUT, type Diagnosis } from '@/utils/diagnosis';

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
  render(Popup, { load, version: '1.3.0', copy });
  return { copy, user: userEvent.setup() };
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

  expect(JSON.parse(copy.mock.calls[0]![0])).toMatchObject({ version: '1.3.0', ...diagnosis });
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
