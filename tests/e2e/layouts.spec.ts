import { badgeText, diagnosis, expect, test } from './fixtures';
import { CHANGES_STEPS, CHANGES_URL, CONVERSATION_URL, reviewOrder, servePullRequest } from './github';

const [first, second] = reviewOrder;

test("reads the review order from GitHub's overview page", async ({ context, page }) => {
  const pr = await servePullRequest(context);
  pr.layout = 'overview';
  await page.goto(CHANGES_URL);

  const panel = page.getByRole('complementary', { name: 'Review order' });
  await expect(panel.getByText(`1 / ${CHANGES_STEPS}`)).toBeVisible();
  await expect(panel.getByText(first!.description)).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Where this order is from' })).toHaveAttribute('href', CONVERSATION_URL);

  expect(await diagnosis(context)).toMatchObject({
    pr: 'acme/repo#1',
    conversation: { state: 'read', layout: 'overview', posts: 1, review: { items: reviewOrder.length } },
    problems: [],
    notes: [expect.stringContaining('loads comments separately')],
    panel: 'shown',
  });
  expect(await badgeText(context)).toBe('');
});

test('keeps working when GitHub switches between its page versions', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  // Nothing viewed, so Next doesn't skip ahead
  pr.viewed.clear();
  await page.goto(CHANGES_URL);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  await panel.getByRole('button', { name: 'Next' }).click();
  await expect(panel.getByText(second!.description)).toBeVisible();

  // Like turning GitHub's new overview on, then off again
  for (const layout of ['overview', 'classic'] as const) {
    pr.layout = layout;
    await page.reload();
    await expect(panel.getByText(`2 / ${CHANGES_STEPS}`)).toBeVisible();
    await expect.poll(async () => (await diagnosis(context)).conversation).toMatchObject({ layout });
  }
});

test("doesn't open the panel for a page it doesn't recognise, but says why on the toolbar button", async ({
  context,
  page,
}) => {
  const pr = await servePullRequest(context);
  pr.layout = 'unknown';
  await page.goto(CHANGES_URL);

  await expect.poll(() => badgeText(context)).toBe('!');
  await expect(page.getByRole('complementary', { name: 'Review order' })).toHaveCount(0);
  expect(await diagnosis(context)).toMatchObject({
    conversation: { state: 'read', layout: null, posts: 0, review: null },
    problems: [expect.stringContaining("doesn't recognise")],
    panel: 'hidden',
  });

  // Once the page is readable again, so is the order
  pr.layout = 'classic';
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Review order' })).toBeVisible();
  await expect.poll(() => badgeText(context)).toBe('');
});

test('says on the toolbar button when the description fails to load', async ({ context, page }) => {
  const pr = await servePullRequest(context);
  pr.conversationStatus = 503;
  await page.goto(CHANGES_URL);

  await expect.poll(() => badgeText(context)).toBe('!');
  expect((await diagnosis(context)).problems).toEqual([expect.stringContaining('GitHub responded with 503')]);
});

test('reports nothing off the changes tab', async ({ context, page }) => {
  await servePullRequest(context);
  await page.goto(CONVERSATION_URL);

  await expect.poll(async () => (await diagnosis(context)).pr).toBeNull();
  expect(await diagnosis(context)).toMatchObject({ conversation: null, problems: [], panel: 'hidden' });
  expect(await badgeText(context)).toBe('');
});
