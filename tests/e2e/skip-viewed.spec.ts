import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { anchorId, CHANGES_URL, CONVERSATION_URL, reviewOrder, servePullRequest, UNLISTED_PATH } from './github';

// The fixture marks the second file as viewed, and only renders a file once it's navigated to
const [first, second, third] = reviewOrder;

function panel(page: Page) {
  return page.getByRole('complementary', { name: 'Review order' });
}

function navigatedFiles(page: Page) {
  return page.evaluate(() => (window as unknown as { navigatedFiles: string[] }).navigatedFiles);
}

test('Next skips viewed files without opening them', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(CHANGES_URL);
  await expect(panel(page).getByText('1 / 3')).toBeVisible();

  await panel(page).getByRole('button', { name: 'Next' }).click();

  await expect(panel(page).getByText('3 / 3')).toBeVisible();
  await expect(panel(page).getByText(third!.description)).toBeVisible();
  await expect(page).toHaveURL(`${CHANGES_URL}#${anchorId(third!.path)}`);
  expect(await navigatedFiles(page)).not.toContain(anchorId(second!.path));
  // The file wasn't rendered when it was navigated to, but it's part of the PR
  await expect(panel(page).getByText('File not found in this PR')).toHaveCount(0);
});

test('opens at the first unviewed file', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  pr.viewed = new Set([first!.path, second!.path]);
  await page.goto(CHANGES_URL);

  await expect(panel(page).getByText('3 / 3')).toBeVisible();
  await expect(page).toHaveURL(`${CHANGES_URL}#${anchorId(third!.path)}`);
});

test('opens at the first file when not skipping viewed ones', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  pr.viewed = new Set([first!.path, second!.path]);
  await page.goto(CHANGES_URL);
  await panel(page).getByRole('checkbox', { name: 'Skip viewed' }).uncheck();
  await panel(page).getByRole('button', { name: 'Previous' }).click();
  await panel(page).getByRole('button', { name: 'Previous' }).click();
  await expect(panel(page).getByText('1 / 3')).toBeVisible();

  await page.reload();
  await expect(panel(page).getByText('1 / 3')).toBeVisible();
  await expect(page).toHaveURL(`${CHANGES_URL}#${anchorId(first!.path)}`);
});

test('can be turned off and stays off', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(CHANGES_URL);
  const toggle = panel(page).getByRole('checkbox', { name: 'Skip viewed' });
  await expect(toggle).toBeChecked();

  await toggle.uncheck();
  await panel(page).getByRole('button', { name: 'Next' }).click();
  await expect(panel(page).getByText('2 / 3')).toBeVisible();
  await expect(panel(page).getByText('File not found in this PR')).toHaveCount(0);

  await page.reload();
  await expect(panel(page).getByRole('checkbox', { name: 'Skip viewed' })).not.toBeChecked();
});

test('follows files being ticked on the page', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(CHANGES_URL);
  await panel(page).getByRole('button', { name: 'Next' }).click();
  await expect(panel(page).getByText('3 / 3')).toBeVisible();

  // Previous skips the viewed second file back to the first
  const previous = panel(page).getByRole('button', { name: 'Previous' });
  await expect(previous).toBeEnabled();

  // Ticking the first file leaves nothing unviewed before the current one
  await page.locator(`#${anchorId(first!.path)}`).getByRole('button', { name: 'Not Viewed' }).click();
  await expect(previous).toBeDisabled();
  await expect(previous).toHaveAttribute('title', 'All files before this one are viewed');

  await page.locator(`#${anchorId(first!.path)}`).getByRole('button', { name: 'Viewed' }).click();
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(panel(page).getByText('1 / 3')).toBeVisible();
});

test('re-reads viewed states after a push and GitHub refresh', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  await page.goto(CHANGES_URL);
  await expect(panel(page).getByText('1 / 3')).toBeVisible();
  // Unlike GitHub, the fixture doesn't re-render files after a refresh, so the second one renders as still ticked
  // once navigated to, which auto-advance would take for the user ticking it
  await panel(page).getByRole('checkbox', { name: 'Auto-advance' }).uncheck();

  // The push changed the second file, so GitHub unticked it; the page's embedded data still says viewed
  pr.headSha = 'b'.repeat(40);
  pr.viewed = new Set();
  const outdated = await page.locator('review-order-panel').elementHandle();
  await page.getByRole('button', { name: 'Refresh' }).click();
  // The new push rebuilds the panel once the viewed states are re-read; a click before that hits the old one
  await expect.poll(() => outdated!.evaluate((host) => host.isConnected)).toBe(false);

  await panel(page).getByRole('button', { name: 'Next' }).click();
  await expect(panel(page).getByText('2 / 3')).toBeVisible();
});

test('marks the review order in the /changes file tree', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(CHANGES_URL);

  for (const [index, item] of reviewOrder.entries()) {
    await expect(page.locator(`[id="${item.path}"]`)).toHaveAttribute('data-review-order-step', String(index + 1));
  }
  await expect(page.locator('[id="src/unlisted.ts"]')).toHaveAttribute('data-review-order-unlisted', '');
  await expect(page.locator('#src')).not.toHaveAttribute('data-review-order-unlisted');
  await expect(page.locator(`[id="${first!.path}"]`)).toHaveAttribute('data-review-order-current', '');
});

test('shows which files are viewed in the file tree', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  pr.viewed = new Set([second!.path, UNLISTED_PATH]);
  await page.goto(CHANGES_URL);
  const eye = (path: string) => page.locator(`[id="${path}"] [data-review-order-eye]`);

  await expect(eye(second!.path)).toBeVisible();
  // Files left out of the order get it next to their warning
  await expect(eye(UNLISTED_PATH)).toBeVisible();
  await expect(page.locator(`[id="${UNLISTED_PATH}"] [data-review-order-marker]`)).toHaveText('!');
  await expect(eye(first!.path)).toHaveCount(0);
  await expect(eye(third!.path)).toHaveCount(0);

  const firstFile = page.locator(`#${anchorId(first!.path)}`);
  await firstFile.getByRole('button', { name: 'Not Viewed' }).click();
  await expect(eye(first!.path)).toBeVisible();
  await firstFile.getByRole('button', { name: 'Viewed' }).click();
  await expect(eye(first!.path)).toHaveCount(0);

  // Closing the panel takes the order out of the tree, but it still shows which files are viewed
  await panel(page).getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('[data-review-order-marker]')).toHaveCount(0);
  await expect(eye(second!.path)).toBeVisible();
  await expect(eye(UNLISTED_PATH)).toBeVisible();
});

const withoutOrder: [string, typeof reviewOrder | null][] = [
  ['without a review order', null],
  ['with a review order section without files', []],
];
for (const [name, items] of withoutOrder) {
  test(`shows which files are viewed ${name}`, async ({ context, page }) => {
    const pr = await servePullRequest(context);
    pr.items = items;
    pr.viewed = new Set([second!.path]);
    const description = page.waitForResponse(CONVERSATION_URL);
    await page.goto(CHANGES_URL);
    await description;
    const eye = (path: string) => page.locator(`[id="${path}"] [data-review-order-eye]`);

    await expect(eye(second!.path)).toBeVisible();
    await expect(eye(first!.path)).toHaveCount(0);
    await expect(page.locator('[data-review-order-marker], [data-review-order-step]')).toHaveCount(0);

    await page.locator(`#${anchorId(first!.path)}`).getByRole('button', { name: 'Not Viewed' }).click();
    await expect(eye(first!.path)).toBeVisible();
  });
}

test('ticking the current file moves on to the next unviewed one', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(CHANGES_URL);
  await expect(panel(page).getByText('1 / 3')).toBeVisible();

  await page.locator(`#${anchorId(first!.path)}`).getByRole('button', { name: 'Not Viewed' }).click();

  await expect(panel(page).getByText('3 / 3')).toBeVisible();
  await expect(page).toHaveURL(`${CHANGES_URL}#${anchorId(third!.path)}`);
});

test('auto-advance can be turned off and stays off', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(CHANGES_URL);
  const toggle = panel(page).getByRole('checkbox', { name: 'Auto-advance' });
  await expect(toggle).toBeChecked();

  await toggle.uncheck();
  await page.locator(`#${anchorId(first!.path)}`).getByRole('button', { name: 'Not Viewed' }).click();
  // The tree's eye follows the same viewed states, so once it shows the tick has been seen
  await expect(page.locator(`[id="${first!.path}"] [data-review-order-eye]`)).toBeVisible();
  await expect(panel(page).getByText('1 / 3')).toBeVisible();

  await page.reload();
  await expect(panel(page).getByRole('checkbox', { name: 'Auto-advance' })).not.toBeChecked();
});

test('the toggles explain themselves on hover', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(CHANGES_URL);
  const tooltip = panel(page).getByRole('tooltip');
  await expect(tooltip).toBeHidden();

  await panel(page).getByText('Skip viewed').hover();
  await expect(tooltip).toHaveText('Next and Previous jump over files marked as viewed');
  await panel(page).getByText('Auto-advance').hover();
  await expect(tooltip).toHaveText('Go to the next file once this one is marked as viewed');
  // Inside the panel, so it's never cut off at the edge of the window
  const [outer, inner] = [(await panel(page).boundingBox())!, (await tooltip.boundingBox())!];
  expect(inner.x).toBeGreaterThanOrEqual(outer.x);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
});
