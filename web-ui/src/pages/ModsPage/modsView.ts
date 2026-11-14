import type { Mod } from '../../api';
import { modProgress } from '../../utils/modProgress';
import { formatModDisplayName, groupModVersions } from './modVersions';

export type ModsSource = 'all' | 'manual' | number;
export type ModsContent = 'all' | 'game' | 'mods';
export type ModStatus = 'todo' | 'review' | 'done';
export type ModsStatusFilter = 'all' | ModStatus;
export type ModsGroupBy = 'none' | 'source' | 'status';

/** Everything the Mods page lets the user pick; it lives in the URL. */
export type ModsView = {
  source: ModsSource;
  content: ModsContent;
  status: ModsStatusFilter;
  q: string;
  group: ModsGroupBy;
};

export const DEFAULT_MODS_VIEW: ModsView = {
  source: 'all',
  content: 'all',
  status: 'all',
  q: '',
  group: 'none',
};

export type ModGroup = { key: string; label?: string; mods: Mod[] };

const CONTENT_VALUES: readonly ModsContent[] = ['all', 'game', 'mods'];
const STATUS_VALUES: readonly ModsStatusFilter[] = ['all', 'todo', 'review', 'done'];
const GROUP_VALUES: readonly ModsGroupBy[] = ['none', 'source', 'status'];
const KIND_RANK: Record<string, number> = { base: 0, dlc: 1, addon: 2 };
const STATUS_ORDER: readonly ModStatus[] = ['todo', 'review', 'done'];

const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Reads the view from the query string; anything unknown falls back to the default. */
export const parseModsView = (params: URLSearchParams): ModsView => {
  const rawSource = params.get('source');
  let source: ModsSource = 'all';
  if (rawSource === 'manual') source = 'manual';
  else if (rawSource && /^[1-9]\d*$/.test(rawSource)) source = Number(rawSource);
  return {
    source,
    content: pick(params.get('content'), CONTENT_VALUES, 'all'),
    status: pick(params.get('status'), STATUS_VALUES, 'all'),
    q: params.get('q') ?? '',
    group: pick(params.get('group'), GROUP_VALUES, 'none'),
  };
};

/** Applies a change to the query string; values equal to the default are left out. */
export const writeModsView = (
  params: URLSearchParams,
  patch: Partial<ModsView>,
): URLSearchParams => {
  const next = new URLSearchParams(params);
  const view = { ...parseModsView(params), ...patch };
  for (const key of Object.keys(DEFAULT_MODS_VIEW) as Array<keyof ModsView>) {
    const value = String(view[key]);
    if (value === String(DEFAULT_MODS_VIEW[key])) next.delete(key);
    else next.set(key, value);
  }
  return next;
};

/** Official game content: the game itself, its DLC and its add-ons. */
const isGameContent = (mod: Mod): boolean => mod.content_kind in KIND_RANK;

/**
 * todo: something is untranslated (also a mod without strings); review: everything is
 * translated but not all approved; done: everything approved.
 */
export const modStatus = (mod: Mod): ModStatus => {
  const { stats } = modProgress(mod);
  if (stats.total === 0 || stats.untranslated > 0) return 'todo';
  return stats.approved >= stats.total ? 'done' : 'review';
};

const sourceKey = (mod: Mod): string =>
  mod.vortex_group_id == null ? 'manual' : String(mod.vortex_group_id);

const matches = (mod: Mod, view: ModsView): boolean => {
  if (view.source === 'manual' && mod.vortex_group_id != null) return false;
  if (typeof view.source === 'number' && mod.vortex_group_id !== view.source) return false;
  if (view.content === 'game' && !isGameContent(mod)) return false;
  if (view.content === 'mods' && isGameContent(mod)) return false;
  if (view.status !== 'all' && modStatus(mod) !== view.status) return false;
  const needle = view.q.trim().toLowerCase();
  return !needle || formatModDisplayName(mod).toLowerCase().includes(needle);
};

/** Keeps version families whose current version matches; older versions follow it. */
export const filterMods = (mods: Mod[], view: ModsView): Mod[] =>
  groupModVersions(mods)
    .filter((family) => matches(family.current, view))
    .flatMap((family) => [family.current, ...family.previous]);

/** Splits families by the kind of their current version. */
const partition = (mods: Mod[], isFirst: (current: Mod) => boolean): [Mod[], Mod[]] => {
  const first: Mod[] = [];
  const second: Mod[] = [];
  for (const family of groupModVersions(mods)) {
    (isFirst(family.current) ? first : second).push(family.current, ...family.previous);
  }
  return [first, second];
};

export const splitByContent = (mods: Mod[]): { game: Mod[]; mods: Mod[] } => {
  const [game, rest] = partition(mods, isGameContent);
  return { game, mods: rest };
};

/** Official add-ons (Creation Club and the like) apart from the game and its DLC. */
export const splitAddons = (mods: Mod[]): { core: Mod[]; addons: Mod[] } => {
  const [addons, core] = partition(mods, (mod) => mod.content_kind === 'addon');
  return { core, addons };
};

const byName = (a: Mod, b: Mod): number => a.name.localeCompare(b.name);

/** Game, then DLC, then add-ons; inside a kind uploads before Vortex, then by name. */
export const sortGameContent = (mods: Mod[]): Mod[] =>
  [...mods].sort(
    (a, b) =>
      (KIND_RANK[a.content_kind] ?? 3) - (KIND_RANK[b.content_kind] ?? 3) ||
      Number(a.vortex_group_id != null) - Number(b.vortex_group_id != null) ||
      byName(a, b),
  );

export const sortModsByName = (mods: Mod[]): Mod[] => [...mods].sort(byName);

/**
 * Buckets version families by their current version. `groupLabelOf` names a bucket from
 * its key: `manual` or a Vortex group id for `source`, `todo` / `review` / `done` for `status`.
 */
export const groupMods = (
  mods: Mod[],
  group: ModsGroupBy,
  groupLabelOf: (key: string) => string,
): ModGroup[] => {
  if (mods.length === 0) return [];
  if (group === 'none') return [{ key: 'all', mods }];

  const keyOf = group === 'source' ? sourceKey : modStatus;
  const buckets = new Map<string, Mod[]>();
  for (const family of groupModVersions(mods)) {
    const key = keyOf(family.current);
    const list = buckets.get(key) ?? [];
    list.push(family.current, ...family.previous);
    buckets.set(key, list);
  }

  const rank = (key: string): number => {
    if (group === 'status') return STATUS_ORDER.indexOf(key as ModStatus);
    return key === 'manual' ? 0 : Number(key);
  };
  return [...buckets.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, list]) => ({ key, label: groupLabelOf(key), mods: list }));
};

/** Progress over the current version of every family (older versions are not counted). */
export const aggregateProgress = (mods: Mod[]) => {
  const sum = { string_count: 0, translated_count: 0, approved_count: 0, fuzzy_count: 0 };
  for (const { current } of groupModVersions(mods)) {
    sum.string_count += Number(current.string_count) || 0;
    sum.translated_count += Number(current.translated_count) || 0;
    sum.approved_count += Number(current.approved_count) || 0;
    sum.fuzzy_count += Number(current.fuzzy_count) || 0;
  }
  return modProgress(sum);
};

export type ContentSummary = {
  /** Version families, one per mod. */
  count: number;
  strings: number;
  translatedPct: number;
  approvedPct: number;
};

const summarize = (mods: Mod[]): ContentSummary | null => {
  if (mods.length === 0) return null;
  const { stats, translatedPct, approvedPct } = aggregateProgress(mods);
  return { count: groupModVersions(mods).length, strings: stats.total, translatedPct, approvedPct };
};

/** Totals for the game and its DLC and for mods; a side without mods is null. */
export const summarizeContent = (
  mods: Mod[],
): { game: ContentSummary | null; mods: ContentSummary | null } => {
  const split = splitByContent(mods);
  return { game: summarize(split.game), mods: summarize(split.mods) };
};
