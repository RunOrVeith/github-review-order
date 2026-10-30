import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { anchorId, CHANGES_URL, MOVED, servePullRequest } from './github';

const RED = 'rgb(255, 235, 233)';

function code(page: Page, path: string, side: 'L' | 'R', line: number) {
  return page.locator(`[data-line-anchor="${anchorId(path)}${side}${line}"]`);
}

const hint = (page: Page) => page.locator('[data-review-order-move-hint] .hint');
const background = (page: Page, path: string, side: 'L' | 'R', line: number) =>
  code(page, path, side, line).evaluate((cell) => {
    const style = getComputedStyle(cell);
    return { color: style.backgroundColor, image: style.backgroundImage };
  });

test('colours a moved function orange where it was removed and striped where it was added', async ({
  context,
  page,
}) => {
  await servePullRequest(context);
  await page.goto(CHANGES_URL);

  const removed = code(page, MOVED.from.path, 'L', MOVED.from.start + 1);
  await expect.poll(async () => (await background(page, MOVED.from.path, 'L', MOVED.from.start + 1)).color).not.toBe(RED);
  await expect(removed).toBeVisible();

  // Hovering says where it went, and the link goes there
  await removed.hover();
  await expect(hint(page)).toHaveText(`Moved to ${MOVED.to.path} lines ${MOVED.to.start}–${MOVED.to.start + 2}`);
  await hint(page).getByRole('link').click();
  // GitHub only follows file anchors, so the URL points at the file, and the line is scrolled to
  await expect(page).toHaveURL(`${CHANGES_URL}#${anchorId(MOVED.to.path)}`);

  const added = code(page, MOVED.to.path, 'R', MOVED.to.start);
  await expect(added).toBeInViewport();
  expect((await background(page, MOVED.to.path, 'R', MOVED.to.start)).image).toContain('repeating-linear-gradient');
  // The line changed next to it didn't move, so it keeps GitHub's plain green
  expect((await background(page, MOVED.to.path, 'R', MOVED.to.start - 1)).image).toBe('none');

  await added.hover();
  await expect(hint(page)).toHaveText(`Moved from ${MOVED.from.path} lines ${MOVED.from.start}–${MOVED.from.start + 2}`);
});

test('shows GitHub\'s own colours while only some commits are shown', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(CHANGES_URL);
  await expect.poll(async () => (await background(page, MOVED.from.path, 'L', MOVED.from.start)).color).not.toBe(RED);

  // GitHub switches to a commit range without reloading the page
  await page.evaluate((sha) => history.pushState(null, '', `/acme/repo/pull/1/changes/${sha}`), 'a'.repeat(40));
  await expect.poll(async () => (await background(page, MOVED.from.path, 'L', MOVED.from.start)).color).toBe(RED);
  await code(page, MOVED.from.path, 'L', MOVED.from.start).hover();
  await expect(hint(page)).toHaveCount(0);

  await page.evaluate(() => history.pushState(null, '', '/acme/repo/pull/1/changes'));
  await expect.poll(async () => (await background(page, MOVED.from.path, 'L', MOVED.from.start)).color).not.toBe(RED);
});
