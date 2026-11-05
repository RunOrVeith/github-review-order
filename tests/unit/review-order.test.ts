import { describe, expect, test } from 'vitest';
import { latestReviewOrder, parseItem, parseReviewOrder, resolvePath, reviewFingerprint } from '@/utils/review-order';

function body(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('parseReviewOrder', () => {
  test('parses the list under a "Review order" heading', () => {
    const items = parseReviewOrder(
      body(`
        <p>Intro</p>
        <h2>Review order</h2>
        <ol>
          <li>src/api/client.ts: new fetch wrapper</li>
          <li>README.md: docs</li>
        </ol>
      `),
    );

    expect(items).toEqual([
      { path: 'src/api/client.ts', description: 'new fetch wrapper' },
      { path: 'README.md', description: 'docs' },
    ]);
  });

  test('matches any heading level and case', () => {
    const items = parseReviewOrder(body('<h3>REVIEW ORDER</h3><ol><li>a.ts: first</li></ol>'));
    expect(items).toEqual([{ path: 'a.ts', description: 'first' }]);
  });

  test("handles GitHub's markdown-heading wrapper and code-formatted paths", () => {
    const items = parseReviewOrder(
      body(`
        <div class="markdown-heading">
          <h2 class="heading-element">Review order</h2><a class="anchor" href="#review-order"></a>
        </div>
        <ol><li><code>src/a.ts</code>: the <strong>core</strong> change</li></ol>
      `),
    );

    expect(items).toEqual([{ path: 'src/a.ts', description: 'the core change' }]);
  });

  test('ignores lists before the heading', () => {
    const items = parseReviewOrder(
      body('<ol><li>wrong.ts: no</li></ol><h2>Review order</h2><ol><li>right.ts: yes</li></ol>'),
    );
    expect(items).toEqual([{ path: 'right.ts', description: 'yes' }]);
  });

  test('stops at the next heading', () => {
    const items = parseReviewOrder(
      body('<h2>Review order</h2><p>None yet</p><h2>Notes</h2><ol><li>other.ts: no</li></ol>'),
    );
    expect(items).toEqual([]);
  });

  test('returns no items for a section without a list', () => {
    expect(parseReviewOrder(body('<h2>Review order</h2><p>Coming soon</p>'))).toEqual([]);
    expect(parseReviewOrder(body('<h2>Review order</h2><ol><li> </li></ol>'))).toEqual([]);
  });

  test('returns null without a review order section', () => {
    expect(parseReviewOrder(body('<h2>Summary</h2><ol><li>a.ts: x</li></ol>'))).toBeNull();
  });

  test('ignores a quoted review order', () => {
    expect(parseReviewOrder(body('<blockquote><h2>Review order</h2><ol><li>a.ts: x</li></ol></blockquote>'))).toBeNull();
  });

  test('matches headings that say more than "Review order"', () => {
    expect(parseReviewOrder(body('<h1>Suggested Review Order</h1><ol><li>a.ts: x</li></ol>'))).toEqual([
      { path: 'a.ts', description: 'x' },
    ]);
    expect(parseReviewOrder(body('<h2>Review order:</h2><ol><li>a.ts: x</li></ol>'))).toHaveLength(1);
  });

  test('takes a bold line for a heading', () => {
    const items = parseReviewOrder(body('<p><strong>Review order</strong></p><ol><li>a.ts: x</li></ol>'));
    expect(items).toEqual([{ path: 'a.ts', description: 'x' }]);
    expect(parseReviewOrder(body('<p><strong>Review order</strong> comes later</p><ol><li>a.ts</li></ol>'))).toBeNull();
  });

  test('reads a bullet list when there is no numbered one', () => {
    expect(parseReviewOrder(body('<h2>Review order</h2><ul><li>a.ts: x</li></ul>'))).toEqual([
      { path: 'a.ts', description: 'x' },
    ]);
    // Notes in bullets before the numbered list aren't the order
    expect(
      parseReviewOrder(body('<h2>Review order</h2><ul><li>note.ts: no</li></ul><ol><li>a.ts: yes</li></ol>')),
    ).toEqual([{ path: 'a.ts', description: 'yes' }]);
  });

  test('reads amatechnology/ama-core#2711', () => {
    const files = new Set([
      'divemate/messaging/campaigns/campaign_rules.py',
      'divemate/messaging/campaigns/campaign_service.py',
      'tests/divemate/messaging/campaigns/test_campaign_rules.py',
      'tests/divemate/messaging/campaigns/test_errors.py',
    ]);
    const items = parseReviewOrder(
      body(`
        <div class="markdown-heading"><h1 class="heading-element">Suggested Review Order</h1><a class="anchor"></a></div>
        <ol>
          <li><code>divemate/messaging/campaigns/campaign_rules.py</code>: <code>CampaignIssueKind</code> (one value per rule), <code>CampaignIssue.kind</code> (required, set by every rule), <code>TemplateSend.language_code</code>, the new <code>_mixed_languages</code> rule</li>
          <li><code>divemate/messaging/campaigns/campaign_service.py</code>: each template's language passed into the rules</li>
          <li>Tests: <code>test_campaign_rules.py</code> (<code>TestMixedLanguages</code>, kinds), <code>test_errors.py</code> (refusal body now carries <code>kind</code>)</li>
        </ol>
        <div class="markdown-heading"><h1 class="heading-element">What's Changed</h1></div>
      `),
      files,
    );

    expect(items).toEqual([
      {
        path: 'divemate/messaging/campaigns/campaign_rules.py',
        description:
          'CampaignIssueKind (one value per rule), CampaignIssue.kind (required, set by every rule), TemplateSend.language_code, the new _mixed_languages rule',
      },
      {
        path: 'divemate/messaging/campaigns/campaign_service.py',
        description: "each template's language passed into the rules",
      },
      {
        path: 'tests/divemate/messaging/campaigns/test_campaign_rules.py',
        description: 'Tests: TestMixedLanguages, kinds',
      },
      {
        path: 'tests/divemate/messaging/campaigns/test_errors.py',
        description: 'Tests: refusal body now carries kind',
      },
    ]);
  });

  test('reads files listed under an item', () => {
    const files = new Set(['src/a.ts', 'tests/a.test.ts', 'tests/b.test.ts']);
    const items = parseReviewOrder(
      body(`
        <h2>Review order</h2>
        <ol>
          <li><code>a.ts</code>: the change</li>
          <li>Tests
            <ul><li><code>a.test.ts</code>: unit</li><li><code>b.test.ts</code>: e2e</li></ul>
          </li>
        </ol>
      `),
      files,
    );

    expect(items).toEqual([
      { path: 'src/a.ts', description: 'the change' },
      { path: 'tests/a.test.ts', description: 'Tests: unit' },
      { path: 'tests/b.test.ts', description: 'Tests: e2e' },
    ]);
  });
});

describe('latestReviewOrder', () => {
  const post = (id: string, html: string) => ({ id, body: body(html) });
  const order = (id: string, path: string) => post(id, `<h2>Review order</h2><ol><li>${path}: x</li></ol>`);

  test('takes the newest post that has a review order', () => {
    const newer = order('comment', 'new.ts');
    const latest = latestReviewOrder([order('description', 'old.ts'), newer, post('thanks', '<p>Thanks!</p>')]);

    expect(latest).toEqual({ items: [{ path: 'new.ts', description: 'x' }], post: newer });
  });

  test('counts a newer section without files', () => {
    const latest = latestReviewOrder([order('description', 'old.ts'), post('comment', '<h2>Review order</h2>')]);
    expect(latest?.items).toEqual([]);
  });

  test('returns null when none has one', () => {
    expect(latestReviewOrder([post('description', '<p>Description</p>')])).toBeNull();
    expect(latestReviewOrder([])).toBeNull();
  });
});

describe('parseItem', () => {
  const files = new Set(['src/api/client.ts', 'src/api/retry.ts', 'src/ui/index.ts', 'src/api/index.ts', 'Makefile']);

  test('keeps colons inside the description', () => {
    expect(parseItem('src/a.ts: note: read this first')).toEqual([
      { path: 'src/a.ts', description: 'note: read this first' },
    ]);
  });

  test('allows items without a description', () => {
    expect(parseItem('README.md')).toEqual([{ path: 'README.md', description: '' }]);
    expect(parseItem('Makefile')).toEqual([{ path: 'Makefile', description: '' }]);
  });

  test('returns nothing for empty items', () => {
    expect(parseItem('   ')).toEqual([]);
  });

  test('splits at a dash between spaces too', () => {
    expect(parseItem('src/a.ts - the core change')).toEqual([{ path: 'src/a.ts', description: 'the core change' }]);
    expect(parseItem('src/a.ts — the core change')).toEqual([{ path: 'src/a.ts', description: 'the core change' }]);
  });

  test("completes a file named by the end of its path to the PR's file", () => {
    expect(parseItem('client.ts: wrapper', files)).toEqual([{ path: 'src/api/client.ts', description: 'wrapper' }]);
    expect(parseItem('api/client.ts: wrapper', files)).toEqual([{ path: 'src/api/client.ts', description: 'wrapper' }]);
    expect(parseItem('./src/api/client.ts', files)).toEqual([{ path: 'src/api/client.ts', description: '' }]);
  });

  test('keeps a path the PR does not have, so it shows as not found', () => {
    expect(parseItem('src/gone.ts: removed?', files)).toEqual([{ path: 'src/gone.ts', description: 'removed?' }]);
    // Two files are called index.ts
    expect(parseItem('index.ts: which one', files)).toEqual([{ path: 'index.ts', description: 'which one' }]);
  });

  test('only takes the first file when it comes first', () => {
    expect(parseItem('client.ts: retries with `retry.ts`', files)).toEqual([
      { path: 'src/api/client.ts', description: 'retries with `retry.ts`' },
    ]);
  });

  test('gives each file after a label the text up to the next one', () => {
    expect(parseItem('API: client.ts (the wrapper), and retry.ts (backoff).', files)).toEqual([
      { path: 'src/api/client.ts', description: 'API: the wrapper' },
      { path: 'src/api/retry.ts', description: 'API: backoff' },
    ]);
    expect(parseItem('Both client.ts and retry.ts', files)).toEqual([
      { path: 'src/api/client.ts', description: 'Both' },
      { path: 'src/api/retry.ts', description: 'Both' },
    ]);
    expect(parseItem('client.ts and client.ts again', files)).toEqual([
      { path: 'src/api/client.ts', description: 'and client.ts again' },
    ]);
  });

  test("without the PR's files, takes words with a folder for the files after a label", () => {
    expect(parseItem('Tests: tests/a.test.ts (unit), Foo.bar')).toEqual([
      { path: 'tests/a.test.ts', description: 'Tests: (unit), Foo.bar' },
    ]);
  });

  test('falls back to the first word when a label names no files', () => {
    expect(parseItem('Tests: the rest', files)).toEqual([{ path: 'Tests', description: 'the rest' }]);
    expect(parseItem('Some tests: the rest', files)).toEqual([]);
  });
});

describe('resolvePath', () => {
  const files = new Set(['src/a.ts', 'src/b/a.ts', 'lib/c.ts']);

  test('takes whole paths and unique endings', () => {
    expect(resolvePath('src/a.ts', files)).toBe('src/a.ts');
    expect(resolvePath('c.ts', files)).toBe('lib/c.ts');
    expect(resolvePath('b/a.ts', files)).toBe('src/b/a.ts');
  });

  test('rejects ambiguous and partial names', () => {
    expect(resolvePath('a.ts', files)).toBeNull();
    expect(resolvePath('.ts', files)).toBeNull();
    expect(resolvePath('', files)).toBeNull();
  });
});

describe('reviewFingerprint', () => {
  const items = [{ path: 'a.ts', description: 'x' }];

  test('changes when new commits are pushed', async () => {
    expect(await reviewFingerprint('a'.repeat(40), items)).not.toBe(await reviewFingerprint('b'.repeat(40), items));
  });

  test('changes when the review order is edited', async () => {
    expect(await reviewFingerprint(null, items)).not.toBe(
      await reviewFingerprint(null, [...items, { path: 'b.ts', description: '' }]),
    );
  });

  test('stays small however long the order is', async () => {
    const long = Array.from({ length: 500 }, (_, i) => ({ path: `src/${i}.ts`, description: 'x'.repeat(100) }));
    expect(await reviewFingerprint(null, long)).toMatch(/^[0-9a-f]{64}$/);
  });
});
