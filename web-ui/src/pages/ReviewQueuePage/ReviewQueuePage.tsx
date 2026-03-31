import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Mod, type ReviewQueueRow } from '../../api';
import { useAuth } from '../../components/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { getCurrentGame } from '../../langDefaults';
import { getContentLanguageOptions, getTgtLang } from '../../langDefaults';
import { PaginationControls } from '../../components/PaginationControls';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfidenceBar } from './ConfidenceBar';
import s from './ReviewQueuePage.module.scss';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Rows shown per page. */
const PAGE_SIZE = 50;

/**
 * Statuses that can be filtered in the review queue.
 * Each entry has a key (matching the translation status) and a display color.
 */
const STATUS_OPTIONS: Array<{ key: string }> = [
  { key: 'auto' },
  { key: 'fuzzy' },
  { key: 'tm' },
  { key: 'draft' },
];

/**
 * Confidence threshold options shown in the dropdown selector.
 * `null` means "no upper bound" (show all confidence values).
 */
const CONFIDENCE_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'All', value: null },
  { label: '< 0.95', value: 0.95 },
  { label: '< 0.85', value: 0.85 },
  { label: '< 0.75', value: 0.75 },
  { label: '< 0.60', value: 0.60 },
];

// ── Main page ─────────────────────────────────────────────────────────────────

/**
 * Review Queue page.
 *
 * Shows a cross-mod table of translations that are in auto/fuzzy/tm/draft status,
 * sorted by confidence ascending so the least-certain strings appear first.
 *
 * The user can:
 * - Filter by target language, translation status, mod, and confidence ceiling
 * - Approve or reject each row inline (single-click)
 * - Navigate directly to the mod editor for any row
 */
export const ReviewQueuePage = () => {
  const { t } = useTranslation();
  const languageOptions = getContentLanguageOptions();
  const { multiUser, user } = useAuth();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();

  // ── Local filter state ───────────────────────────────────────────────────
  const [targetLang, setTargetLang] = useState(getTgtLang());
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(
    new Set(STATUS_OPTIONS.map((o) => o.key)),
  );
  /** Initialise from ?modId= URL param so the post-LLM banner deep-link works. */
  const [selectedModId, setSelectedModId] = useState<number | null>(() => {
    const raw = searchParams.get('modId');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  const [maxConfidence, setMaxConfidence] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const currentGameId = getCurrentGame();

  const resetFilters = () => {
    setActiveStatuses(new Set(STATUS_OPTIONS.map((o) => o.key)));
    setSelectedModId(null);
    setMaxConfidence(null);
    setPage(1);
  };

  /** Toggle a single status on/off in the filter chip group. */
  const toggleStatus = (key: string) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      setPage(1);
      return next;
    });
  };

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data: mods } = useQuery({
    queryKey: ['mods'],
    queryFn: () => api.mods.list(),
  });

  const statuses = [...activeStatuses];
  const { data, isLoading } = useQuery({
    queryKey: ['reviewQueue', targetLang, statuses.sort(), selectedModId, maxConfidence, page],
    queryFn: () =>
      api.reviewQueue.list({
        targetLang,
        statuses,
        modId: selectedModId ?? undefined,
        maxConfidence: maxConfidence ?? undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    enabled: statuses.length > 0,
  });

  const totalRows = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const emptyHint = multiUser && user
    ? user.role === 'reviewer'
      ? t('reviewQueue.emptyReviewerHint')
      : user.role === 'admin'
        ? t('reviewQueue.emptyAdminHint')
        : t('reviewQueue.emptyTranslatorHint')
    : t('reviewQueue.emptyTranslatorHint');

  // ── Approve / Reject mutations ────────────────────────────────────────────
  /**
   * Mutates a single string's status to 'reviewed' or 'rejected'.
   * Uses the existing /api/strings/:id/status endpoint.
   * Invalidates the review queue query so the row disappears after action.
   */
  const statusMut = useMutation({
    mutationFn: ({ row, newStatus }: { row: ReviewQueueRow; newStatus: string }) =>
      api.strings.updateStatus(row.string_id, row.translation_id, newStatus),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviewQueue'] });
      qc.invalidateQueries({ queryKey: ['strings'] });
      qc.invalidateQueries({ queryKey: ['qa'] });
    },
  });

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={s.page}>
      <PageHeader
        title={t('reviewQueue.title')}
        description={t('reviewQueue.description')}
        level={2}
      />

      {/* Toolbar */}
      <div className={s.toolbar}>
        {/* Language */}
        <span className={s.label}>{t('reviewQueue.lang')}:</span>
        <select
          className={s.select}
          value={targetLang}
          onChange={(e) => { setTargetLang(e.target.value); setPage(1); }}
        >
          {languageOptions.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>

        {/* Status chips */}
        <span className={s.label}>{t('reviewQueue.statusFilter')}:</span>
        <div className={s.statusGroup}>
          {STATUS_OPTIONS.map((o) => (
            <label
              key={o.key}
              className={`${s.statusChip} ${activeStatuses.has(o.key) ? s.active : ''}`}
              onClick={() => toggleStatus(o.key)}
            >
              <input type="checkbox" checked={activeStatuses.has(o.key)} readOnly />
              {t(`status.${o.key}`, { defaultValue: o.key })}
            </label>
          ))}
        </div>

        {/* Mod filter */}
        <span className={s.label}>{t('reviewQueue.mod')}:</span>
        <select
          className={s.select}
          value={selectedModId ?? ''}
          onChange={(e) => { setSelectedModId(e.target.value ? Number(e.target.value) : null); setPage(1); }}
        >
          <option value="">{t('reviewQueue.allMods')}</option>
          {(mods ?? []).map((m: Mod) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        {/* Confidence ceiling */}
        <span className={s.label}>{t('reviewQueue.maxConf')}:</span>
        <select
          className={s.select}
          value={maxConfidence ?? ''}
          onChange={(e) => { setMaxConfidence(e.target.value ? Number(e.target.value) : null); setPage(1); }}
        >
          {CONFIDENCE_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ''}>{t(`reviewQueue.confOpt_${o.label.replace(/[^a-z0-9]/gi, '_')}`, { defaultValue: o.label })}</option>
          ))}
        </select>

        {!isLoading && (
          <span className={s.totalBadge}>
            {t('reviewQueue.total', { count: totalRows })}
          </span>
        )}
      </div>

      {/* Loading / empty states */}
      {isLoading && <div className={s.empty}>{t('reviewQueue.loading')}</div>}

      {!isLoading && (statuses.length === 0 || totalRows === 0) && (
        <div className={s.emptyState}>
          <div className={s.emptyText}>
            {statuses.length === 0 ? t('reviewQueue.noStatuses') : t('reviewQueue.empty')}
          </div>
          {statuses.length > 0 && <p className={s.emptyHint}>{emptyHint}</p>}
          <div className={s.emptyActions}>
            <button className={s.emptyBtn} onClick={resetFilters}>
              {statuses.length === 0 ? t('reviewQueue.enableStatusesAction') : t('reviewQueue.resetFiltersAction')}
            </button>
            <Link className={s.emptyLinkBtn} to={currentGameId ? `/games/${currentGameId}` : '/games'}>
              {currentGameId ? t('reviewQueue.openCurrentGameAction') : t('reviewQueue.openGamesAction')}
            </Link>
            {multiUser && user?.role === 'admin' && statuses.length > 0 && (
              <Link className={s.emptyLinkBtn} to="/settings?tab=activity">
                {t('reviewQueue.openActivityAction')}
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      {!isLoading && (data?.rows ?? []).length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>{t('reviewQueue.colMod')}</th>
                <th className={s.th}>{t('reviewQueue.colGrup')}</th>
                <th className={s.th}>{t('reviewQueue.colEdid')}</th>
                <th className={s.th}>{t('reviewQueue.colSource')}</th>
                <th className={s.th}>{t('reviewQueue.colTranslation')}</th>
                <th className={s.th}>{t('reviewQueue.colStatus')}</th>
                <th className={s.th}>{t('reviewQueue.colConf')}</th>
                <th className={s.th}>{t('reviewQueue.colTranslator')}</th>
                <th className={s.th}>{t('reviewQueue.colQA')}</th>
                <th className={s.th}>{t('reviewQueue.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {data!.rows.map((row) => (
                <tr key={row.string_id} className={s.tr}>
                  <td className={s.td}>
                    <span className={s.modName}>{row.mod_name}</span>
                  </td>
                  <td className={s.td}>
                    <span className={s.grup}>{row.signature}</span>
                  </td>
                  <td className={s.td}>
                    {row.edid && <span className={s.edid}>{row.edid}</span>}
                  </td>
                  <td className={s.td}>
                    <span className={s.sourceText} title={row.source}>{row.source}</span>
                  </td>
                  <td className={s.td}>
                    <span className={s.translText} title={row.translation}>{row.translation}</span>
                  </td>
                  <td className={s.td}>
                    <StatusBadge status={row.status} small />
                  </td>
                  <td className={s.td}>
                    <ConfidenceBar value={row.confidence} />
                  </td>
                  <td className={s.td}>
                    <span className={s.translatorName}>{row.translator_name ?? '—'}</span>
                  </td>
                  <td className={s.td}>
                    {row.qa_issue_count > 0 && (
                      <span className={s.qaBadge}>{row.qa_issue_count}</span>
                    )}
                  </td>
                  <td className={s.td}>
                    <div className={s.actions}>
                      {/* Approve button */}
                      <button
                        className={s.approveBtn}
                        disabled={statusMut.isPending}
                        onClick={() => statusMut.mutate({ row, newStatus: 'reviewed' })}
                        title={t('reviewQueue.approve')}
                      >
                        ✓
                      </button>
                      {/* Reject button */}
                      <button
                        className={s.rejectBtn}
                        disabled={statusMut.isPending}
                        onClick={() => statusMut.mutate({ row, newStatus: 'rejected' })}
                        title={t('reviewQueue.reject')}
                      >
                        ✗
                      </button>
                      {/* Open in mod editor — filtered by this row's status to land on relevant strings */}
                      <Link
                        className={s.openBtn}
                        to={`/games/${row.mod_game}/mods/${row.mod_id}?status=${encodeURIComponent(row.status)}`}
                        title={t('reviewQueue.openInEditor')}
                      >
                        ↗
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className={s.pagination}>
          <PaginationControls
            info={<span className={s.pageInfo}>{t('reviewQueue.page', { current: page, total: totalPages })}</span>}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            prevDisabled={page <= 1}
            nextDisabled={page >= totalPages}
            prevLabel="←"
            nextLabel="→"
          />
        </div>
      )}
    </div>
  );
};

