import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type CoherenceGroup, type CoherenceEntry } from '../api';
import { getTgtLang } from '../langDefaults';
import s from './CoherencePage.module.scss';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of groups displayed per page. */
const PAGE_SIZE = 30;

/** Language options shown in the language selector. */
const LANG_OPTIONS = [
  { code: 'uk', label: 'Українська (uk)' },
  { code: 'ru', label: 'Русский (ru)' },
  { code: 'de', label: 'Deutsch (de)' },
  { code: 'fr', label: 'Français (fr)' },
  { code: 'pl', label: 'Polski (pl)' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Groups the flat entries list of a CoherenceGroup by their translation text.
 * Returns an array of { translation, entries[] } sorted by entry count DESC.
 */
const groupByVariant = (entries: CoherenceEntry[]) => {
  const map = new Map<string, CoherenceEntry[]>();
  for (const e of entries) {
    const list = map.get(e.translation);
    if (list) {
      list.push(e);
    } else {
      map.set(e.translation, [e]);
    }
  }
  // Sort variants by number of strings that use them (most popular first)
  return Array.from(map.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([translation, strings]) => ({ translation, strings }));
};

// ── Sub-components ────────────────────────────────────────────────────────────

type VariantCardProps = {
  translation: string;
  strings: CoherenceEntry[];
  /** Called when the user clicks "Apply to All". Disabled while mutating. */
  onApply: (translation: string) => void;
  isApplying: boolean;
  t: ReturnType<typeof useTranslation>['t'];
};

/**
 * Displays one translation variant within a coherence group.
 * Lists all strings that currently use this translation, and offers an
 * "Apply to All" button to propagate it to the rest of the group.
 */
const VariantCard = ({ translation, strings, onApply, isApplying, t }: VariantCardProps) => (
  <div className={s.variant}>
    <div className={s.variantHeader}>
      <span className={s.variantText}>{translation}</span>
      <button
        className={s.applyBtn}
        disabled={isApplying}
        onClick={() => onApply(translation)}
        title={t('coherence.applyToAllTitle')}
      >
        {t('coherence.applyToAll')}
      </button>
    </div>
    <div className={s.variantStrings}>
      {strings.map((e) => (
        <span key={e.string_id} className={s.variantString}>
          <span className={s.modName}>{e.mod_name}</span>
          {e.edid && <span className={s.edidTag}>{e.edid}</span>}
          <span>{e.signature}{e.path_simplified ? ` › ${e.path_simplified}` : ''}</span>
          <span>({e.status})</span>
        </span>
      ))}
    </div>
  </div>
);

type GroupCardProps = {
  group: CoherenceGroup;
  onResolve: (textNorm: string, translation: string) => void;
  isResolving: boolean;
  t: ReturnType<typeof useTranslation>['t'];
};

/**
 * Displays one coherence group — a source text with multiple inconsistent
 * translations.  Clicking the header expands the group to show all variants
 * and the strings that use them.
 */
const GroupCard = ({ group, onResolve, isResolving, t }: GroupCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const variants = useMemo(() => groupByVariant(group.entries), [group.entries]);

  return (
    <div className={s.group}>
      {/* Collapsible header — shows source text and variant count badge */}
      <div className={s.groupHeader} onClick={() => setExpanded((v) => !v)}>
        <span className={s.groupToggle}>{expanded ? '▼' : '▶'}</span>
        <span className={s.groupSource} title={group.source_text}>
          {group.source_text}
        </span>
        <span className={s.groupBadge}>
          {t('coherence.variantsBadge', { count: group.variant_count })}
        </span>
      </div>

      {/* Expanded body — one card per distinct translation variant */}
      {expanded && (
        <div className={s.variants}>
          {variants.map((v) => (
            <VariantCard
              key={v.translation}
              translation={v.translation}
              strings={v.strings}
              onApply={(tr) => onResolve(group.text_norm, tr)}
              isApplying={isResolving}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

/**
 * Coherence checking page.
 *
 * Shows all source strings that share the same normalised text but are
 * translated inconsistently across mods.  The user can review each conflict
 * group and apply a single chosen translation to every string in the group
 * with one click.
 *
 * Layout:
 *   - Language selector + total count
 *   - Paginated list of group cards (each collapsible)
 *   - Pagination controls
 */
export const CoherencePage = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // ── Local state ──────────────────────────────────────────────────────────
  const [targetLang, setTargetLang] = useState(getTgtLang());
  const [page, setPage] = useState(0);

  const offset = page * PAGE_SIZE;

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['coherence', targetLang, page],
    queryFn: () => api.coherence.list({ targetLang, limit: PAGE_SIZE, offset }),
    placeholderData: keepPreviousData,
  });

  const totalGroups = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE));

  // ── Resolve mutation ─────────────────────────────────────────────────────
  /**
   * Propagates the chosen translation to all strings in the group.
   * Invalidates the coherence query so the group disappears once resolved.
   */
  const resolveMut = useMutation({
    mutationFn: ({ textNorm, translation }: { textNorm: string; translation: string }) =>
      api.coherence.resolve(textNorm, translation, targetLang),
    onSuccess: () => {
      // Re-fetch coherence data and also invalidate QA issue counts in the editor
      qc.invalidateQueries({ queryKey: ['coherence'] });
      qc.invalidateQueries({ queryKey: ['qa'] });
      qc.invalidateQueries({ queryKey: ['strings'] });
    },
  });

  const handleResolve = (textNorm: string, translation: string) => {
    resolveMut.mutate({ textNorm, translation });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={s.page}>
      {/* Page header */}
      <div className={s.header}>
        <h2 className={s.title}>{t('coherence.title')}</h2>
      </div>
      <p className={s.description}>{t('coherence.description')}</p>

      {/* Toolbar: language selector + total */}
      <div className={s.toolbar}>
        <span className={s.langLabel}>{t('coherence.targetLang')}:</span>
        <select
          className={s.select}
          value={targetLang}
          onChange={(e) => { setTargetLang(e.target.value); setPage(0); }}
        >
          {LANG_OPTIONS.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        {!isLoading && (
          <span className={s.totalBadge}>
            {t('coherence.totalGroups', { count: totalGroups })}
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading && <div className={s.empty}>{t('coherence.loading')}</div>}

      {!isLoading && totalGroups === 0 && (
        <div className={s.empty}>{t('coherence.noIssues')}</div>
      )}

      {!isLoading && (data?.groups ?? []).map((group) => (
        <GroupCard
          key={group.text_norm}
          group={group}
          onResolve={handleResolve}
          isResolving={resolveMut.isPending}
          t={t}
        />
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className={s.pagination}>
          <button
            className={s.pageBtn}
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ←
          </button>
          <span className={s.pageInfo}>
            {t('coherence.page', { current: page + 1, total: totalPages })}
          </span>
          <button
            className={s.pageBtn}
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
};
