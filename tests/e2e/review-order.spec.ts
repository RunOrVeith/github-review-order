import { expect, test } from './fixtures';
import { anchorId, CONVERSATION_URL, FILES_URL, reviewOrder, servePullRequest } from './github';

const [first, second] = reviewOrder;

test('steps through the files in review order', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);

  const panel = page.getByRole('complementary', { name: 'Review order' });
  await expect(panel.getByText('1 / 3')).toBeVisible();
  await expect(panel.getByText(first!.description)).toBeVisible();
  await expect(page).toHaveURL(`${FILES_URL}#${anchorId(first!.path)}`);

  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText('2 / 3')).toBeVisible();
  await expect(panel.getByText(second!.description)).toBeVisible();
  await expect(page).toHaveURL(`${FILES_URL}#${anchorId(second!.path)}`);
  await expect(page.locator(`#${anchorId(second!.path)}`)).toBeInViewport();

  await page.mouse.wheel(0, 3000);
  await expect(page.locator(`#${anchorId(second!.path)}`)).not.toBeInViewport();
  await panel.getByRole('button', { name: 'Reset current' }).click();
  await expect(page.locator(`#${anchorId(second!.path)}`)).toBeInViewport();
});

test('only shows the panel on the changes tab', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(CONVERSATION_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });

  // GitHub switches tabs without reloading the page
  await page.evaluate(() => history.pushState(null, '', '/acme/repo/pull/1/files'));
  await expect(panel).toBeVisible();

  await page.evaluate(() => history.pushState(null, '', '/acme/repo/pull/1'));
  await expect(panel).toHaveCount(0);
});

test('keeps progress across reloads until new commits are pushed', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });

  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText('2 / 3')).toBeVisible();

  await page.reload();
  await expect(panel.getByText('2 / 3')).toBeVisible();

  pr.headSha = 'b'.repeat(40);
  await page.reload();
  await expect(panel.getByText('1 / 3')).toBeVisible();
});
