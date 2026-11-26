import { DEFAULT_MIN_MOVED_LINES } from '@/utils/moves';
import type { Settings } from '@/utils/settings';

/** The settings as the content script follows them, so the panel updates when they change in the popup. */
export class LiveSettings implements Settings {
  skipViewed = $state(true);
  autoAdvance = $state(true);
  showMovedLines = $state(true);
  minMovedLines = $state(DEFAULT_MIN_MOVED_LINES);

  constructor(initial: Partial<Settings> = {}) {
    Object.assign(this, initial);
  }
}
