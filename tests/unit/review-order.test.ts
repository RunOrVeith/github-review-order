import { describe, expect, test } from 'vitest';
import { latestReviewOrder, parseItem, parseReviewOrder, reviewFingerprint } from '@/utils/review-order';

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
  test('keeps colons inside the description', () => {
    expect(parseItem('src/a.ts: note: read this first')).toEqual({
      path: 'src/a.ts',
      description: 'note: read this first',
    });
  });

  test('allows items without a description', () => {
    expect(parseItem('README.md')).toEqual({ path: 'README.md', description: '' });
  });

  test('returns null for empty items', () => {
    expect(parseItem('   ')).toBeNull();
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
