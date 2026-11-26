// The user's settings, shared by all PRs. They're changed in the toolbar button's popup, which
// lists them from SETTINGS, and the content script follows changes without a reload.
import { DEFAULT_MIN_MOVED_LINES } from './moves';

/** Whether Next and Previous skip files ticked as viewed. */
export const skipViewed = storage.defineItem<boolean>('local:skipViewed', { fallback: true });

/** Whether ticking the current file as viewed moves on to the next one. */
export const autoAdvance = storage.defineItem<boolean>('local:autoAdvance', { fallback: true });

/** Whether code a PR only moves is striped, with a hint saying where it went. */
export const showMovedLines = storage.defineItem<boolean>('local:showMovedLines', { fallback: true });

/** How many lines code moved elsewhere needs before it's striped. */
export const minMovedLines = storage.defineItem<number>('local:minMovedLines', { fallback: DEFAULT_MIN_MOVED_LINES });

export interface Settings {
  skipViewed: boolean;
  autoAdvance: boolean;
  showMovedLines: boolean;
  minMovedLines: number;
}

type KeysOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];

interface SettingBase<K extends keyof Settings> {
  key: K;
  label: string;
  /** Says what it does, under its control. */
  hint: string;
  item: WxtStorageItem<Settings[K], {}>;
}

/** A whole number, e.g. a threshold, kept between min and max. */
export interface NumberSetting extends SettingBase<KeysOf<number>> {
  kind: 'number';
  min: number;
  max: number;
}

/** A checkbox, with the settings that only matter while it's on. */
export interface ToggleSetting extends SettingBase<KeysOf<boolean>> {
  kind: 'toggle';
  children?: readonly NumberSetting[];
}

export type SettingDefinition = ToggleSetting | NumberSetting;

/**
 * Every setting, in the order the popup shows them. A new setting only has to
 * be added here and to Settings; one that only matters while another is on
 * goes into that one's children.
 */
export const SETTINGS: readonly ToggleSetting[] = [
  {
    kind: 'toggle',
    key: 'skipViewed',
    label: 'Skip viewed',
    hint: 'Next and Previous jump over files marked as viewed',
    item: skipViewed,
  },
  {
    kind: 'toggle',
    key: 'autoAdvance',
    label: 'Auto-advance',
    hint: 'Go to the next file once this one is marked as viewed',
    item: autoAdvance,
  },
  {
    kind: 'toggle',
    key: 'showMovedLines',
    label: 'Show moved lines',
    hint: 'Stripe code that was only moved, and say where it went on hover',
    item: showMovedLines,
    children: [
      {
        kind: 'number',
        key: 'minMovedLines',
        label: 'Minimum lines',
        hint: 'How many lines moved code needs to be striped. Fewer catches more, but also common lines like imports.',
        item: minMovedLines,
        min: 1,
        max: 20,
      },
    ],
  },
];

/** Every setting, the ones that depend on another included. */
export const ALL_SETTINGS: readonly SettingDefinition[] = SETTINGS.flatMap((setting) => [
  setting,
  ...(setting.children ?? []),
]);

/** The value to use for what's stored, e.g. a number kept in range even if storage was edited by hand. */
export function settingValue<D extends SettingDefinition>(setting: D, value: unknown): Settings[D['key']] {
  if (setting.kind === 'toggle') return (typeof value === 'boolean' ? value : setting.item.fallback) as Settings[D['key']];
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : setting.item.fallback;
  return Math.min(setting.max, Math.max(setting.min, number)) as Settings[D['key']];
}

export async function loadSettings(): Promise<Settings> {
  const values = await Promise.all(
    ALL_SETTINGS.map(async (setting) => [setting.key, settingValue(setting, await setting.item.getValue())] as const),
  );
  return Object.fromEntries(values) as unknown as Settings;
}

/** Calls back with each setting that changes, e.g. in the popup; returns a function that stops it. */
export function watchSettings(onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void): () => void {
  const unwatchers = ALL_SETTINGS.map((setting) =>
    (setting.item as WxtStorageItem<unknown, {}>).watch((value) => onChange(setting.key, settingValue(setting, value))),
  );
  return () => unwatchers.forEach((unwatch) => unwatch());
}
