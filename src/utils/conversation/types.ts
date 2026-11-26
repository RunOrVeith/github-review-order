import type { PullPost } from '../github';

/** What every layout gets to read from: the fetched conversation page and the data GitHub embeds in it. */
export interface ConversationPage {
  doc: Document;
  /** The `payload` of GitHub's embedded data, or null without it; anything in it may be missing. */
  payload: Record<string, unknown> | null;
  /** The PR author's login, if the page says. */
  author: string | null;
}

/** What a layout read from the page. */
export interface ConversationReading {
  /** The description, then the comments that may set a newer review order, oldest first. */
  posts: PullPost[];
  /** What this layout can't read, e.g. comments that load separately. Shown in the diagnosis. */
  limitations: string[];
}

/**
 * One version of GitHub's conversation page. GitHub rolls out new versions to
 * some accounts while others keep the old one, so every version still served
 * has its own layout, and each fetched page is read by the first that matches.
 * A new version is supported by adding a layout to CONVERSATION_LAYOUTS.
 */
export interface ConversationLayout {
  /** Shown in the diagnosis, e.g. "classic". */
  name: string;
  /** Whether the page is this version; only then is it read with this layout. */
  matches(page: ConversationPage): boolean;
  read(page: ConversationPage): ConversationReading;
}
