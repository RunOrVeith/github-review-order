import { classicLayout } from './classic';
import { overviewLayout } from './overview';
import type { ConversationLayout, ConversationPage, ConversationReading } from './types';

export type { ConversationLayout, ConversationPage, ConversationReading } from './types';

/**
 * Every version of the conversation page GitHub may serve, most specific first.
 * Which one a user gets depends on GitHub's rollout, so they all stay until the old ones are gone.
 */
export const CONVERSATION_LAYOUTS: readonly ConversationLayout[] = [overviewLayout, classicLayout];

/** Reads the page with the first layout that recognises it; null when none does, as when GitHub changed it again. */
export function readConversation(
  page: ConversationPage,
  layouts: readonly ConversationLayout[] = CONVERSATION_LAYOUTS,
): (ConversationReading & { layout: string }) | null {
  const layout = layouts.find((candidate) => candidate.matches(page));
  return layout ? { layout: layout.name, ...layout.read(page) } : null;
}
