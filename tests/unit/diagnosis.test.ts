import { describe, expect, test } from 'vitest';
import {
  diagnose,
  NO_REVIEW_ORDER,
  NO_TREE,
  NOT_A_CHANGES_TAB,
  type DiagnosisInput,
} from '@/entrypoints/review-order.content/diagnose';
import { UNREADABLE_TREE } from '@/entrypoints/review-order.content/tree-markers';
import {
  conversationProblems,
  EMPTY_SECTION,
  isDiagnoseMessage,
  isProblemsMessage,
  UNRECOGNIZED_LAYOUT,
  type ConversationState,
} from '@/utils/diagnosis';

const read = (overrides: Partial<Extract<ConversationState, { state: 'read' }>> = {}): ConversationState => ({
  state: 'read',
  layout: 'classic',
  posts: 1,
  headSha: 'a'.repeat(40),
  limitations: [],
  review: { source: 'File order from the PR description', items: 2 },
  ...overrides,
});

describe('conversationProblems', () => {
  test.each<[string, ConversationState | null, string[]]>([
    ['off a changes tab', null, []],
    ['while loading', { state: 'loading' }, []],
    ['with a review order', read(), []],
    ['without a review order', read({ review: null }), []],
    ['when loading failed', { state: 'failed', reason: 'GitHub is down' }, ['GitHub is down']],
    ['when no layout recognised the page', read({ layout: null, posts: 0, review: null }), [UNRECOGNIZED_LAYOUT]],
    ['when the section lists no files', read({ review: { source: 'x', items: 0 } }), [EMPTY_SECTION]],
  ])('%s', (_, conversation, problems) => {
    expect(conversationProblems(conversation)).toEqual(problems);
  });
});

describe('diagnose', () => {
  const input = (overrides: Partial<DiagnosisInput> = {}): DiagnosisInput => ({
    url: 'https://github.com/acme/repo/pull/1/changes',
    pr: 'acme/repo#1',
    conversation: read(),
    panel: 'shown',
    ...overrides,
  });

  function changesPage(tree: string) {
    const doc = document.implementation.createHTMLDocument();
    const data = { payload: { pullRequestsChangesRoute: { diffSummaries: [{ pathDigest: 'a'.repeat(64), markedAsViewed: true }] } } };
    doc.body.innerHTML = `
      <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify(data)}</script>
      ${tree}
      <div id="diff-${'a'.repeat(64)}"><button aria-pressed="true" aria-label="Viewed"></button></div>`;
    return doc;
  }
  const tree = '<ul role="tree"><li role="treeitem" id="src/a.ts">a.ts</li><li role="treeitem" id="b.ts">b.ts</li></ul>';

  test('reports what the page has', () => {
    expect(diagnose(input(), changesPage(tree))).toEqual({
      ...input(),
      tree: { files: 2, unreadable: false },
      viewed: { rendered: 1, embedded: 1 },
      problems: [],
      notes: [],
    });
  });

  test("doesn't look at pages other than a changes tab", () => {
    expect(diagnose(input({ pr: null, conversation: null, panel: 'hidden' }), changesPage(tree))).toMatchObject({
      tree: null,
      viewed: null,
      problems: [],
      notes: [NOT_A_CHANGES_TAB],
    });
  });

  test('reports an unrecognised layout and an unreadable tree as problems', () => {
    const unreadable = '<ul role="tree"><li role="treeitem">a.ts</li></ul>';
    const conversation = read({ layout: null, posts: 0, review: null });
    expect(diagnose(input({ conversation, panel: 'hidden' }), changesPage(unreadable))).toMatchObject({
      problems: [UNRECOGNIZED_LAYOUT, UNREADABLE_TREE],
      notes: [],
    });
  });

  test("notes what isn't a problem", () => {
    const conversation = read({ review: null, limitations: ['Comments load separately.'] });
    expect(diagnose(input({ conversation, panel: 'closed' }), changesPage(''))).toMatchObject({
      problems: [],
      notes: ['Comments load separately.', NO_REVIEW_ORDER, NO_TREE],
    });
  });
});

test('recognises its messages', () => {
  expect(isDiagnoseMessage({ type: 'review-order:diagnose' })).toBe(true);
  expect(isDiagnoseMessage({ type: 'other' })).toBe(false);
  expect(isDiagnoseMessage(undefined)).toBe(false);
  expect(isProblemsMessage({ type: 'review-order:problems', count: 1 })).toBe(true);
  expect(isProblemsMessage({ type: 'review-order:problems' })).toBe(false);
});
