/** Statuses assignable from the row context menu (excludes skip and untranslated). */
export const CONTEXT_MENU_STATUSES = [
  'draft',
  'reviewed',
  'rejected',
  'tm',
  'fuzzy',
  'auto',
] as const;

export type ContextMenuStatus = (typeof CONTEXT_MENU_STATUSES)[number];

/** Status values available in the editor filter (excluding the "all" sentinel). */
export const STATUS_FILTER_OPTS = [
  'untranslated',
  'draft',
  'reviewed',
  'rejected',
  'skip',
  'tm',
  'fuzzy',
  'auto',
] as const;

export type StatusFilterValue = (typeof STATUS_FILTER_OPTS)[number];

const VALID = new Set<string>(STATUS_FILTER_OPTS);

/** Parses `status` URL / API param (`draft,reviewed`) into a deduped selection. */
export const parseStatusParam = (param: string | null | undefined): StatusFilterValue[] => {
  if (!param || param === 'all') return [];
  const out: StatusFilterValue[] = [];
  for (const raw of param.split(',')) {
    const token = raw.trim();
    if (VALID.has(token) && !out.includes(token as StatusFilterValue)) {
      out.push(token as StatusFilterValue);
    }
  }
  return out;
};

/** Serialises a status selection for URL / API (undefined = show all). */
export const statusParamFromSelection = (selected: readonly string[]): string | undefined => {
  const tokens = selected.filter((s) => VALID.has(s));
  return tokens.length > 0 ? tokens.join(',') : undefined;
};

/** Toggles one status token in a multi-select filter. */
export const toggleStatusSelection = (
  selected: readonly string[],
  status: string,
): StatusFilterValue[] => {
  const set = new Set(selected.filter((s) => VALID.has(s)));
  if (set.has(status)) set.delete(status);
  else set.add(status);
  return STATUS_FILTER_OPTS.filter((s) => set.has(s));
};
