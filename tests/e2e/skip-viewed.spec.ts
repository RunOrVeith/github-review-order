import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { anchorId, CHANGES_URL, reviewOrder, servePullRequest } from './github';

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

  // The push changed the second file, so GitHub unticked it; the page's embedded data still says viewed
  pr.headSha = 'b'.repeat(40);
  pr.viewed = new Set();
  const refetch = page.waitForResponse(CHANGES_URL);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await refetch;

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
