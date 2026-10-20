import type { Page } from '@playwright/test';
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

test("picks up new pushes from GitHub's in-page Refresh without a reload", async ({ context, page }) => {
  const pr = await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });

  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText('2 / 3')).toBeVisible();

  // Nothing changed yet, so the panel keeps its step once the re-check is done
  const recheck = page.waitForResponse(CONVERSATION_URL);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await recheck;
  await expect(panel.getByText('2 / 3')).toBeVisible();

  pr.headSha = 'b'.repeat(40);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel.getByText('1 / 3')).toBeVisible();
});

test('picks up new pushes when the window gets focus again', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });

  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText('2 / 3')).toBeVisible();

  pr.headSha = 'b'.repeat(40);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel.getByText('1 / 3')).toBeVisible();
});

async function dragPanel(page: Page, to: { x: number; y: number }) {
  const handle = page.getByRole('group', { name: 'Drag to move' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

function viewportSize(page: Page) {
  return page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
}

test('can be dragged out of the way and stays there', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  const before = (await panel.boundingBox())!;

  await dragPanel(page, { x: 60, y: 40 });
  const moved = (await panel.boundingBox())!;
  expect(moved.x).toBeLessThan(before.x);
  expect(moved.y).toBeLessThan(before.y);

  // Navigating must not move it back
  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText('2 / 3')).toBeVisible();
  expect(await panel.boundingBox()).toMatchObject({ x: moved.x, y: moved.y });

  await page.reload();
  await expect(panel).toBeVisible();
  expect(await panel.boundingBox()).toMatchObject({ x: moved.x, y: moved.y });
});

test('grows upward when parked at the bottom edge', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  const viewport = await viewportSize(page);

  await dragPanel(page, { x: 300, y: viewport.height });
  const parked = (await panel.boundingBox())!;
  expect(parked.y + parked.height).toBeCloseTo(viewport.height, 0);

  // The second description wraps onto more lines
  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText('2 / 3')).toBeVisible();
  // The new size is only reported on the next frame, so wait for the layout to settle
  const bottomEdge = async () => {
    const box = (await panel.boundingBox())!;
    return Math.round(box.y + box.height);
  };
  await expect.poll(bottomEdge).toBe(Math.round(viewport.height));
  expect((await panel.boundingBox())!.height).toBeGreaterThan(parked.height);
});

test('keeps its corner when the window is resized', async ({ context, page }) => {
  await servePullRequest(context);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });

  const distanceToCorner = async () => {
    const box = (await panel.boundingBox())!;
    const viewport = await viewportSize(page);
    return { right: viewport.width - box.x - box.width, bottom: viewport.height - box.y - box.height };
  };
  const original = await distanceToCorner();

  await page.setViewportSize({ width: 900, height: 500 });
  await expect.poll(distanceToCorner).toEqual(original);

  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(distanceToCorner).toEqual(original);
});
