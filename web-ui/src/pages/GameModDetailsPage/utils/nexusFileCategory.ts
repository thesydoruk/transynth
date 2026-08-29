import type { TFunction } from 'i18next';

const CATEGORY_KEYS: Record<string, string> = {
  main: 'main',
  optional: 'optional',
  miscellaneous: 'miscellaneous',
  'old version': 'old_version',
  updates: 'updates',
  archived: 'archived',
};

/** Localize a Nexus file category name; unknown values stay as returned by the API. */
export const nexusFileCategoryLabel = (
  categoryName: string | null | undefined,
  t: TFunction,
): string => {
  if (!categoryName) return '—';
  const normalized = categoryName.toLowerCase().replace(/_/g, ' ');
  const key = CATEGORY_KEYS[normalized];
  return key ? t(`games.fileCategories.${key}`) : categoryName;
};
