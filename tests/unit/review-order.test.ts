import { describe, expect, test } from 'vitest';
import { parseItem, parseReviewOrder, reviewFingerprint } from '@/utils/review-order';

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
    expect(items).toBeNull();
  });

  test('returns null without a review order section', () => {
    expect(parseReviewOrder(body('<h2>Summary</h2><ol><li>a.ts: x</li></ol>'))).toBeNull();
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

  test('changes when new commits are pushed', () => {
    expect(reviewFingerprint('a'.repeat(40), items)).not.toBe(reviewFingerprint('b'.repeat(40), items));
  });

  test('changes when the review order is edited', () => {
    expect(reviewFingerprint(null, items)).not.toBe(
      reviewFingerprint(null, [...items, { path: 'b.ts', description: '' }]),
    );
  });
});
