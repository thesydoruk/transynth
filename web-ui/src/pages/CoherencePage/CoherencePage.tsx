import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { getTgtLang } from '../../langDefaults';
import { ConfirmModal } from '../../components/ConfirmModal';
import { Toast } from '../../components/Toast';
import { GroupCard } from './GroupCard';
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
  const [showResolveAllConfirm, setShowResolveAllConfirm] = useState(false);
  const [resolveAllToast, setResolveAllToast] = useState<string | null>(null);

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

  // ── Resolve-all mutation ─────────────────────────────────────────────────
  /** Auto-resolves every group by plurality winner; shows a toast with the result. */
  const resolveAllMut = useMutation({
    mutationFn: () => api.coherence.resolveAll(targetLang),
    onSuccess: (result) => {
      setShowResolveAllConfirm(false);
      setResolveAllToast(t('coherence.resolveAllSuccess', { groups: result.resolved, updated: result.updated }));
      qc.invalidateQueries({ queryKey: ['coherence'] });
      qc.invalidateQueries({ queryKey: ['qa'] });
      qc.invalidateQueries({ queryKey: ['strings'] });
    },
  });

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
        {!isLoading && totalGroups > 0 && (
          <button
            className={s.resolveAllBtn}
            onClick={() => setShowResolveAllConfirm(true)}
            disabled={resolveAllMut.isPending}
          >
            {t('coherence.resolveAllBtn')}
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading && <div className={s.empty}>{t('coherence.loading')}</div>}

      {!isLoading && totalGroups === 0 && (
        <div className={s.emptyState}>
          <div className={s.emptyText}>{t('coherence.noIssues')}</div>
          <div className={s.emptyActions}>
            <button className={s.emptyBtn} onClick={() => qc.invalidateQueries({ queryKey: ['coherence'] })}>
              {t('coherence.refreshAction')}
            </button>
            <Link className={s.emptyLinkBtn} to="/review-queue">
              {t('coherence.openReviewQueueAction')}
            </Link>
          </div>
        </div>
      )}

      {!isLoading && (data?.groups ?? []).map((group) => (
        <GroupCard
          key={group.text_norm}
          group={group}
          onResolve={handleResolve}
          isResolving={resolveMut.isPending}
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

      {/* Resolve-all confirmation modal */}
      {showResolveAllConfirm && (
        <ConfirmModal
          title={t('coherence.resolveAllConfirmTitle')}
          message={t('coherence.resolveAllConfirmBody')}
          confirmLabel={t('coherence.resolveAllBtn')}
          pending={resolveAllMut.isPending}
          onConfirm={() => resolveAllMut.mutate()}
          onClose={() => setShowResolveAllConfirm(false)}
        />
      )}

      {/* Success toast after resolve-all */}
      <Toast message={resolveAllToast} onDismiss={() => setResolveAllToast(null)} />
    </div>
  );
};

