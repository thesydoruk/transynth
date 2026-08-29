import type { Mod, Stats } from '../api';

type ModCounts = Pick<Mod, 'string_count' | 'translated_count' | 'approved_count' | 'fuzzy_count'>;

const pct = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

/** Derive progress bar stats and percentage columns from mod aggregate counters. */
export const modProgress = (mod: ModCounts) => {
  const total = Number(mod.string_count) || 0;
  const translated = Number(mod.translated_count) || 0;
  const approved = Number(mod.approved_count) || 0;
  const fuzzy = Number(mod.fuzzy_count) || 0;

  const stats: Stats = {
    total,
    translated,
    approved,
    draft: 0,
    rejected: 0,
    tm: 0,
    fuzzy,
    auto_translated: translated - approved - fuzzy,
    skipped: 0,
    untranslated: total - translated,
    percent: pct(translated, total),
  };

  return {
    stats,
    translatedPct: stats.percent,
    approvedPct: pct(approved, total),
    fuzzyPct: pct(fuzzy, total),
  };
};
