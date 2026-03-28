/**
 * ActivityPage — displays a paginated, filterable audit log of user actions.
 *
 * Shows all recorded activity (login, import, translate, approve, etc.)
 * with timestamps, user attribution, and affected entities.
 * Available in both single-user and multi-user modes.
 *
 * Filters: action type, entity (mod), date range.
 * CSV export downloads the full filtered result (up to 10 000 rows).
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api, type ActivityEntry, type Mod } from '../../api';
import { PaginationControls } from '../../components/PaginationControls';
import s from './ActivityPage.module.scss';

/** Number of entries per page. */
const PAGE_SIZE = 50;

/** Known action types for the filter dropdown. */
const ACTION_TYPES = [
  '', 'login', 'logout', 'translate', 'import', 'approve',
  'export', 'create_user', 'update_user', 'change_password',
];

export const ActivityPage = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialOffset = Number(searchParams.get('offset') ?? '0');
  const initialEntityType = searchParams.get('entityType');
  const initialEntityId = Number(searchParams.get('entityId') ?? '');
  const [offset, setOffset] = useState(Number.isFinite(initialOffset) && initialOffset >= 0 ? initialOffset : 0);
  const [actionFilter, setActionFilter] = useState(searchParams.get('action') ?? '');
  const [modFilter, setModFilter] = useState<number | ''>(initialEntityType === 'mod' && Number.isFinite(initialEntityId) ? initialEntityId : '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') ?? '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') ?? '');
  const [csvPending, setCsvPending] = useState(false);

  const params = {
    limit: PAGE_SIZE,
    offset,
    action: actionFilter || undefined,
    entityType: modFilter !== '' ? 'mod' : undefined,
    entityId: modFilter !== '' ? modFilter : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data } = useQuery({
    queryKey: ['activity', offset, actionFilter, modFilter, dateFrom, dateTo],
    queryFn: () => api.activity.list(params),
  });

  const { data: mods } = useQuery<Mod[]>({
    queryKey: ['mods'],
    queryFn: () => api.mods.list(),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleFilterChange = () => setOffset(0);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'activity');
    if (offset > 0) next.set('offset', String(offset));
    else next.delete('offset');
    if (actionFilter) next.set('action', actionFilter);
    else next.delete('action');
    if (modFilter !== '') {
      next.set('entityType', 'mod');
      next.set('entityId', String(modFilter));
    } else {
      next.delete('entityType');
      next.delete('entityId');
    }
    if (dateFrom) next.set('dateFrom', dateFrom);
    else next.delete('dateFrom');
    if (dateTo) next.set('dateTo', dateTo);
    else next.delete('dateTo');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [offset, actionFilter, modFilter, dateFrom, dateTo, searchParams, setSearchParams]);

  const handleCsvDownload = async () => {
    setCsvPending(true);
    try {
      await api.activity.csvDownload({
        action: actionFilter || undefined,
        entityType: modFilter !== '' ? 'mod' : undefined,
        entityId: modFilter !== '' ? modFilter : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
    } finally {
      setCsvPending(false);
    }
  };

  return (
    <div className={s.page}>
      <h2 className={s.title}>{t('activity.title')}</h2>

      {/* Filters */}
      <div className={s.filters}>
        <select
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); handleFilterChange(); }}
        >
          <option value="">{t('activity.allActions')}</option>
          {ACTION_TYPES.filter(Boolean).map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          value={modFilter}
          onChange={e => { setModFilter(e.target.value === '' ? '' : Number(e.target.value)); handleFilterChange(); }}
        >
          <option value="">{t('activity.allMods')}</option>
          {(mods ?? []).map((m: Mod) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        <div className={s.dateGroup}>
          <label className={s.dateLabel}>{t('activity.from')}</label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={e => { setDateFrom(e.target.value); handleFilterChange(); }}
          />
        </div>

        <div className={s.dateGroup}>
          <label className={s.dateLabel}>{t('activity.to')}</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={e => { setDateTo(e.target.value); handleFilterChange(); }}
          />
        </div>

        <button
          className={s.csvBtn}
          disabled={csvPending || entries.length === 0}
          onClick={handleCsvDownload}
          title={t('activity.exportCsvTitle')}
        >
          {csvPending ? t('activity.exporting') : t('activity.exportCsv')}
        </button>
      </div>

      {/* Table */}
      {entries.length === 0 ? (
        <div className={s.empty}>{t('activity.noActivity')}</div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t('activity.time')}</th>
              <th>{t('activity.user')}</th>
              <th>{t('activity.action')}</th>
              <th>{t('activity.entity')}</th>
              <th>{t('activity.details')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e: ActivityEntry) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td>{e.display_name ?? e.username ?? '—'}</td>
                <td><span className={s.actionBadge}>{e.action}</span></td>
                <td>
                  {e.entity_type && e.entity_id != null
                    ? `${e.entity_type} #${e.entity_id}`
                    : e.entity_type ?? '—'}
                </td>
                <td className={s.details}>
                  {e.details ? JSON.stringify(e.details) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className={s.pagination}>
          <PaginationControls
            info={<>{t('common.page', { page, totalPages })} ({t('activity.entries', { total })})</>}
            onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            onNext={() => setOffset((o) => o + PAGE_SIZE)}
            prevDisabled={offset === 0}
            nextDisabled={offset + PAGE_SIZE >= total}
          />
        </div>
      )}
    </div>
  );

};

