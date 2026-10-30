import type { Locator, Page } from '@playwright/test';
import { clickToolbarButton, expect, test } from './fixtures';
import {
  anchorId,
  CONVERSATION_URL,
  FILES_STEPS,
  FILES_URL,
  LONG_PATH,
  reviewOrder,
  servePullRequest,
  UNLISTED_PATH,
} from './github';

const [first, second] = reviewOrder;

test('steps through the files in review order', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);

  const panel = page.getByRole('complementary', { name: 'Review order' });
  await expect(panel.getByText(`1 / ${FILES_STEPS}`)).toBeVisible();
  await expect(panel.getByText(first!.description)).toBeVisible();
  const source = panel.getByRole('link', { name: 'Where this order is from' });
  await expect(source).toHaveAttribute('href', CONVERSATION_URL);
  await expect(panel.getByRole('tooltip')).toBeHidden();
  await source.hover();
  await expect(panel.getByRole('tooltip')).toBeVisible();
  await expect(panel.getByRole('tooltip')).toHaveText('File order from the PR description');
  await expect(page).toHaveURL(`${FILES_URL}#${anchorId(first!.path)}`);

  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();
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
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();

  await page.reload();
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();

  pr.headSha = 'b'.repeat(40);
  await page.reload();
  await expect(panel.getByText(`1 / ${FILES_STEPS}`)).toBeVisible();
});

test("picks up new pushes from GitHub's in-page Refresh without a reload", async ({ context, page }) => {
  const pr = await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });

  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();

  // Nothing changed yet, so the panel keeps its step once the re-check is done
  const recheck = page.waitForResponse(CONVERSATION_URL);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await recheck;
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();

  pr.headSha = 'b'.repeat(40);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel.getByText(`1 / ${FILES_STEPS}`)).toBeVisible();
});

test('picks up new pushes when the window gets focus again', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });

  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();

  pr.headSha = 'b'.repeat(40);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel.getByText(`1 / ${FILES_STEPS}`)).toBeVisible();
});

test('a collaborator can comment a new order, but other commenters cannot', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  const reversed = [...reviewOrder].reverse();
  pr.comments = [
    { login: 'carol', role: 'Collaborator', items: reversed },
    { login: 'mallory', role: 'Contributor', items: [first!] },
  ];
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });

  await expect(panel.getByText(`1 / ${FILES_STEPS}`)).toBeVisible();
  await expect(panel.getByText(reversed[0]!.description)).toBeVisible();
  const source = panel.getByRole('link', { name: 'Where this order is from' });
  await expect(source).toHaveAccessibleDescription("File order from @carol's comment");
  await expect(source).toHaveAttribute('href', `${CONVERSATION_URL}#issuecomment-2`);
  await expect(treeEntry(page, reversed[0]!.path)).toHaveAttribute('data-review-order-step', '1');
});

test('keeps the panel and says so when GitHub fails to serve the description', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  const failure = panel.getByText(
    "Couldn't load the latest review order (GitHub responded with 503), so this may be out of date.",
  );

  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();

  pr.conversationStatus = 503;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(failure).toBeVisible();
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();

  // The last known order is still there after a reload
  await page.reload();
  await expect(failure).toBeVisible();
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();

  pr.conversationStatus = 200;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(failure).toHaveCount(0);
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();
});

test('explains a review order section without files', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  pr.items = [];
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });

  await expect(panel.getByText('The "Review order" section has no numbered list of files.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Next' })).toHaveCount(0);
  await expect(page.locator('[data-review-order-marker]')).toHaveCount(0);
});

test('steps through the files left out of the order after it', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  await expect(panel.getByText(`1 / ${FILES_STEPS}`)).toBeVisible();

  for (let step = 0; step < reviewOrder.length; step++) {
    await panel.getByRole('button', { name: 'Next' }).click();
  }

  // The first one the tree has after the order's files
  await expect(panel.getByText(`${reviewOrder.length + 1} / ${FILES_STEPS}`)).toBeVisible();
  await expect(panel.getByText(UNLISTED_PATH)).toBeVisible();
  await expect(panel.getByText('Not in the review order')).toBeVisible();
  await expect(page).toHaveURL(`${FILES_URL}#${anchorId(UNLISTED_PATH)}`);
  await expect(treeEntry(page, UNLISTED_PATH)).toHaveAttribute('data-review-order-current', '');
});

function treeEntry(page: Page, path: string) {
  return page.locator(`#file-tree-item-${anchorId(path)}`);
}

function isVisibleInSidebar(entry: Locator) {
  return entry.evaluate((element) => {
    const sidebar = document.getElementById('sidebar')!.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return rect.top >= sidebar.top && rect.bottom <= sidebar.bottom;
  });
}

test('marks the review order in the file tree', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);

  for (const [index, item] of reviewOrder.entries()) {
    await expect(treeEntry(page, item.path)).toHaveAttribute('data-review-order-step', String(index + 1));
  }
  await expect(treeEntry(page, UNLISTED_PATH)).toHaveAttribute('data-review-order-unlisted', '');
  await expect(treeEntry(page, UNLISTED_PATH)).toHaveAttribute('title', 'Not in the review order');
  await expect(treeEntry(page, UNLISTED_PATH)).not.toHaveAttribute('data-review-order-step');
  await expect(treeEntry(page, first!.path)).toHaveAttribute('data-review-order-current', '');
});

test('keeps the current file visible in the tree on every step', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  const last = reviewOrder.at(-1)!;

  // The last file is at the bottom of the tree, below the sidebar's visible area
  expect(await isVisibleInSidebar(treeEntry(page, last.path))).toBe(false);
  await panel.getByRole('button', { name: 'Next' }).click();
  await panel.getByRole('button', { name: 'Next' }).click();

  await expect(treeEntry(page, last.path)).toHaveAttribute('data-review-order-current', '');
  await expect(treeEntry(page, second!.path)).not.toHaveAttribute('data-review-order-current');
  await expect.poll(() => isVisibleInSidebar(treeEntry(page, last.path))).toBe(true);
  // Only the tree scrolled; the page still shows the file's diff
  await expect(page.locator(`#${anchorId(last.path)}`)).toBeInViewport();

  await page.locator('#sidebar').evaluate((sidebar) => (sidebar.scrollTop = 0));
  await panel.getByRole('button', { name: 'Reset current' }).click();
  await expect.poll(() => isVisibleInSidebar(treeEntry(page, last.path))).toBe(true);
});

test("keeps both GitHub's active-file indicator and the step badge", async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  const active = treeEntry(page, first!.path);
  const badge = active.locator('[data-review-order-marker]');

  await expect(badge).toHaveText('1');
  await expect(badge).toBeVisible();
  const githubIndicator = await active.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return { content: style.content, width: style.width };
  });
  expect(githubIndicator).toEqual({ content: '""', width: '4px' });
});

test('truncates long file names before their badge', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  const entry = treeEntry(page, LONG_PATH);
  await expect(entry.locator('[data-review-order-marker]')).toHaveText('!');

  const name = (await entry.locator('a').boundingBox())!;
  const badge = (await entry.locator('[data-review-order-marker]').boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(badge.x);
});

test('shows the last known order right away while the description loads', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  await expect(panel.getByText(`1 / ${FILES_STEPS}`)).toBeVisible();

  pr.conversationDelay = 3000;
  await page.reload();
  await expect(panel.getByText(`1 / ${FILES_STEPS}`)).toBeVisible({ timeout: 1000 });
  await expect(treeEntry(page, first!.path)).toHaveAttribute('data-review-order-step', '1', { timeout: 1000 });
});

test('marks the tree again after GitHub re-renders it', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  await expect(treeEntry(page, first!.path)).toHaveAttribute('data-review-order-step', '1');

  await page.evaluate(() => {
    const template = document.querySelector<HTMLTemplateElement>('#file-tree-template')!;
    document.querySelector('nav')!.replaceChildren(template.content.cloneNode(true));
  });

  await expect(treeEntry(page, first!.path)).toHaveAttribute('data-review-order-step', '1');
  await expect(treeEntry(page, first!.path)).toHaveAttribute('data-review-order-current', '');
  await expect(treeEntry(page, UNLISTED_PATH)).toHaveAttribute('data-review-order-unlisted', '');
});

test('closing the panel removes the tree markers', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  await expect(treeEntry(page, first!.path)).toHaveAttribute('data-review-order-step', '1');

  await panel.getByRole('button', { name: 'Close' }).click();

  await expect(page.locator('[data-review-order-step], [data-review-order-unlisted], [data-review-order-current]')).toHaveCount(0);
  await expect(treeEntry(page, UNLISTED_PATH)).not.toHaveAttribute('title');
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
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();
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
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();
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

test('a double-click minimizes the panel under the pointer, and it stays that way', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  const handle = page.getByRole('group', { name: 'Drag to move' });
  const box = async () => {
    const { x, y, width, height } = (await panel.boundingBox())!;
    return { left: Math.round(x), top: Math.round(y), width: Math.round(width), height: Math.round(height) };
  };
  const expanded = await box();

  // Shrinks toward its top-left corner and grows back down from it, so the header stays under the pointer.
  // The new size is only measured on the next frame, so wait for the layout to settle.
  await handle.getByText(`1 / ${FILES_STEPS}`).dblclick();
  await expect(panel.getByText(first!.description)).toHaveCount(0);
  await expect.poll(box).toMatchObject({ left: expanded.left, top: expanded.top });
  const minimized = await box();
  expect(minimized.width).toBeLessThan(expanded.width);
  expect(minimized.height).toBeLessThan(expanded.height);

  await handle.getByText(`1 / ${FILES_STEPS}`).dblclick();
  await expect.poll(box).toEqual(expanded);
  await handle.getByText(`1 / ${FILES_STEPS}`).dblclick();
  await expect.poll(box).toEqual(minimized);

  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();
  await expect(page).toHaveURL(`${FILES_URL}#${anchorId(second!.path)}`);

  await page.reload();
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();
  await expect(panel.getByText(second!.description)).toHaveCount(0);
  // "2 / …" is a little wider than "1 / …", so only the top is exactly where it was
  await expect.poll(async () => (await box()).top).toBe(minimized.top);

  // Minimized, the step is what's left to double-click besides the arrows
  await panel.getByText(`2 / ${FILES_STEPS}`).dblclick();
  await expect(panel.getByText(second!.description)).toBeVisible();
});

test('the toolbar button brings back a closed panel where it left off', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();

  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);

  await clickToolbarButton(context);
  await expect(panel.getByText(`2 / ${FILES_STEPS}`)).toBeVisible();
  await expect(treeEntry(page, first!.path)).toHaveAttribute('data-review-order-step', '1');

  // Clicking it again doesn't add a second panel
  await clickToolbarButton(context);
  await expect(panel).toHaveCount(1);
});

test('the toolbar button expands a minimized panel', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(FILES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  await page.getByRole('group', { name: 'Drag to move' }).getByText(`1 / ${FILES_STEPS}`).dblclick();
  await expect(panel.getByText(first!.description)).toHaveCount(0);

  await clickToolbarButton(context);
  await expect(panel.getByText(first!.description)).toBeVisible();

  // It stays expanded, like expanding it by hand
  await page.reload();
  await expect(panel.getByText(first!.description)).toBeVisible();
});
