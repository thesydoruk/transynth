import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ProgressBar, StatusBadge } from '../components/StatusBadge';
import s from './ModsPage.module.scss';

export const ModsPage = () => {
  const nav = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['mods'],
    queryFn: api.mods.list,
  });

  if (isLoading) return <div className={s.center}>Loading mods…</div>;
  if (error) return <div className={`${s.center} ${s.error}`}>Error: {String(error)}</div>;
  if (!data?.length)
    return (
      <div className={s.center}>
        <h2>No mods found</h2>
        <p className={s.hintText}>
          Run <code>npm run learn:pairs</code> or <code>npm run learn:multilang</code> to import
          translation data.
        </p>
      </div>
    );

  return (
    <div className={s.page}>
      <h1 className={s.title}>Mods</h1>
      <table className={s.table}>
        <thead>
          <tr>
            <th className={s.th}>Name</th>
            <th className={s.th}>Strings</th>
            <th className={s.th}>Progress</th>
            <th className={s.th}>Approved</th>
            <th className={s.th}>Fuzzy</th>
          </tr>
        </thead>
        <tbody>
          {data.map((mod) => {
            const approvedPct =
              mod.string_count > 0 ? Math.round((mod.approved_count / mod.string_count) * 100) : 0;
            const fuzzyPct =
              mod.string_count > 0 ? Math.round((mod.fuzzy_count / mod.string_count) * 100) : 0;
            const translatedPct =
              mod.string_count > 0
                ? Math.round((mod.translated_count / mod.string_count) * 100)
                : 0;

            return (
              <tr
                key={mod.id}
                className={s.rowHover}
                onClick={() => nav(`/mods/${mod.id}`)}
              >
                <td className={s.td}>
                  <strong className={s.modName}>{mod.name}</strong>
                </td>
                <td className={`${s.td} ${s.tdRight}`}>{mod.string_count}</td>
                <td className={`${s.td} ${s.tdProgress}`}>
                  <ProgressBar
                    stats={{
                      total: mod.string_count,
                      translated: mod.translated_count,
                      approved: mod.approved_count,
                      draft: 0,
                      rejected: 0,
                      tm: 0,
                      fuzzy: mod.fuzzy_count,
                      auto_translated: mod.translated_count - mod.approved_count - mod.fuzzy_count,
                      untranslated: mod.string_count - mod.translated_count,
                      percent: translatedPct,
                    }}
                  />
                </td>
                <td className={s.td}>
                  <StatusBadge status={approvedPct === 100 ? 'human' : null} small />
                  <span className={`${s.pctLabel} ${s.pctApproved}`}>{approvedPct}%</span>
                </td>
                <td className={s.td}>
                  <span className={s.pctLabel}>{fuzzyPct}%</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

