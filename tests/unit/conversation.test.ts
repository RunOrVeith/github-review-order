import { describe, expect, test } from 'vitest';
import { CONVERSATION_LAYOUTS, readConversation, type ConversationLayout } from '@/utils/conversation';

const page = { doc: document.implementation.createHTMLDocument(), payload: null, author: null };

const layout = (name: string, matches: boolean): ConversationLayout => ({
  name,
  matches: () => matches,
  read: () => ({ posts: [], limitations: [name] }),
});

describe('readConversation', () => {
  test('reads the page with the first layout that recognises it', () => {
    const layouts = [layout('new', false), layout('newer', true), layout('old', true)];
    expect(readConversation(page, layouts)).toEqual({ layout: 'newer', posts: [], limitations: ['newer'] });
  });

  test('is null when no layout recognises the page', () => {
    expect(readConversation(page, [layout('old', false)])).toBeNull();
  });

  test("tries GitHub's overview page before the classic one", () => {
    expect(CONVERSATION_LAYOUTS.map((candidate) => candidate.name)).toEqual(['overview', 'classic']);
  });
});
