/**
 * ActivityPage — displays a paginated, filterable audit log of user actions.
 *
 * Shows all recorded activity (login, import, translate, approve, etc.)
 * with timestamps, user attribution, and affected entities.
 * Available in both single-user and multi-user modes.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ActivityEntry } from '../api';
import s from './ActivityPage.module.scss';

/** Number of entries per page. */
const PAGE_SIZE = 50;

/** Known action types for the filter dropdown. */
const ACTION_TYPES = [
  '', 'login', 'logout', 'translate', 'import', 'approve',
  'export', 'create_user', 'update_user', 'change_password',
];

export const ActivityPage = () => {
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState('');

  const { data } = useQuery({
    queryKey: ['activity', offset, actionFilter],
    queryFn: () => api.activity.list({
      limit: PAGE_SIZE,
      offset,
      action: actionFilter || undefined,
    }),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className={s.page}>
      <h2 className={s.title}>Activity Log</h2>

      {/* Filters */}
      <div className={s.filters}>
        <select
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setOffset(0); }}
        >
          <option value="">All actions</option>
          {ACTION_TYPES.filter(Boolean).map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {entries.length === 0 ? (
        <div className={s.empty}>No activity recorded yet.</div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
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
          <button
            className={s.pageBtn}
            disabled={offset === 0}
            onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
          >
            ← Prev
          </button>
          <span>Page {page} of {totalPages} ({total} entries)</span>
          <button
            className={s.pageBtn}
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(o => o + PAGE_SIZE)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};
