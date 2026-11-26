/**
 * Regenerates the README's screenshots from real PRs in this repo, with the built extension loaded
 * into Playwright's bundled Chromium in GitHub's dark theme.
 *
 *   npm run screenshots -- --login   # once: log into GitHub in the window that opens, then close it
 *   npm run screenshots              # build, then overwrite screenshots/*.png
 *   npm run screenshots -- --headed  # the same, but watch it work
 *
 * The repo is private, so it needs a login. The browser profile lives in .wxt/screenshots-profile,
 * so the login is kept between runs. The eyes in the file tree are the files that account has
 * marked as viewed on the PR.
 */
import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, '.output/chrome-mv3');
const profile = path.join(root, '.wxt/screenshots-profile');
const outDir = path.join(root, 'screenshots');

const REPO = 'https://github.com/RunOrVeith/github-review-order';
/** Whose description's review order goes into review_order.png. */
const REVIEW_ORDER_PR = 7;
/** Whose changes tab goes into overlay.png and file_tree.png. */
const CHANGES_PR = 12;
/** The step the panel is on in overlay.png, and the file highlighted in file_tree.png. */
const OVERLAY_STEP = 2;

const args = new Set(process.argv.slice(2));
const login = args.has('--login');
const headed = login || args.has('--headed');

async function launch(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profile, {
    // The bundled Chromium channel is the only one that can load extensions headless
    channel: 'chromium',
    headless: !headed,
    colorScheme: 'dark',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
}

async function logIn(context: BrowserContext) {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('https://github.com/login');
  console.log('Log into GitHub in the browser window, then close it.');
  await new Promise((resolve) => context.on('close', resolve));
}

/** Opens a page of this repo, which is private, so GitHub answers 404 when logged out. */
async function open(page: Page, url: string) {
  const response = await page.goto(url);
  if (response?.status() === 404) {
    throw new Error(`GitHub answered 404 for ${url}. Run \`npm run screenshots -- --login\` once to log in.`);
  }
}

async function reviewOrder(page: Page) {
  await open(page, `${REPO}/pull/${REVIEW_ORDER_PR}`);
  // The description's heading; the classic page wraps it in a div, and the numbered list follows that
  const heading = page.locator('.markdown-body h2', { hasText: /^\s*Review order\s*$/ }).first();
  // GitHub's React page swaps the server-rendered description for its own right after loading, so
  // it measures as empty or half laid out for a moment. Waits until two measurements agree.
  let box: Clip | null = null;
  let previous: Clip | null = null;
  for (let attempt = 0; attempt < 20 && !box; attempt++) {
    if (attempt > 0) await page.waitForTimeout(500);
    const current = await measureSection(heading);
    if (current && JSON.stringify(current) === JSON.stringify(previous)) box = current;
    previous = current;
  }
  if (!box) throw new Error('The "Review order" section never settled on a size on the page');
  // The section can reach past the bottom of the window, which a clip of the window would cut off
  await page.screenshot({ path: path.join(outDir, 'review_order.png'), clip: box, fullPage: true });
  console.log('Wrote screenshots/review_order.png');
}

type Clip = { x: number; y: number; width: number; height: number };

/** The heading and its numbered list in page coordinates, with some padding, or null while they aren't laid out. */
function measureSection(heading: Locator): Promise<Clip | null> {
  return heading.evaluate((element, padding) => {
    const start = element.parentElement?.classList.contains('markdown-heading') ? element.parentElement : element;
    let list = start.nextElementSibling;
    while (list && list.tagName !== 'OL' && !list.matches('.markdown-heading, h1, h2, h3')) {
      list = list.nextElementSibling;
    }
    if (list?.tagName !== 'OL') list = null;
    if (!list) throw new Error('No numbered list after the "Review order" heading');
    const top = start.getBoundingClientRect();
    const bottom = list.getBoundingClientRect();
    if (!element.isConnected || top.height === 0 || bottom.height === 0) return null;
    const x = Math.min(top.left, bottom.left) - padding;
    const y = top.top - padding;
    return {
      x: x + window.scrollX,
      y: y + window.scrollY,
      width: Math.max(top.right, bottom.right) + padding - x,
      height: bottom.bottom + padding - y,
    };
  }, 12);
}

async function changes(page: Page) {
  await open(page, `${REPO}/pull/${CHANGES_PR}/changes`);
  const panel = page.getByRole('complementary', { name: 'Review order' });
  await stepTo(panel, OVERLAY_STEP);
  // Keeps hover styles and the arrows' tooltips out of the pictures
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await panel.screenshot({ path: path.join(outDir, 'overlay.png') });

  const tree = page.getByRole('tree', { name: 'File Tree' });
  await tree.locator('[data-review-order-current]').waitFor();
  await tree.screenshot({ path: path.join(outDir, 'file_tree.png') });
  console.log('Wrote screenshots/overlay.png and screenshots/file_tree.png');
}

/** Steps the panel back or forward until it shows the given step. */
async function stepTo(panel: Locator, target: number) {
  const counter = panel.locator('.step');
  await counter.waitFor();
  for (let attempt = 0; attempt < 20; attempt++) {
    const [, current] = /(\d+) \/ \d+/.exec(await counter.innerText())!;
    if (Number(current) === target) return;
    const button = panel.getByRole('button', { name: Number(current) < target ? 'Next' : 'Previous' });
    // Skip viewed can make the target unreachable, so stop where the arrows run out
    if (await button.isDisabled()) break;
    await button.click();
    await panel.page().waitForTimeout(300);
  }
  console.warn(`Couldn't step the panel to ${target}, it's on ${await counter.innerText()}`);
}

const context = await launch();
try {
  if (login) {
    await logIn(context);
  } else {
    const page = context.pages()[0] ?? (await context.newPage());
    await reviewOrder(page);
    await changes(page);
  }
} finally {
  await context.close();
}
