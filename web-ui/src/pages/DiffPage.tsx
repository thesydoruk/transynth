import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type DiffEntry } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import s from './DiffPage.module.scss';

const CHANGE_COLORS: Record<string, string> = {
  added: '#1b3a1b',
  removed: '#3a1b1b',
  changed: '#2a2a0f',
};

const CHANGE_LABELS: Record<string, string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
};

export const DiffPage = () => {
  const { data: mods } = useQuery({ queryKey: ['mods'], queryFn: api.mods.list });
  const queryClient = useQueryClient();

  const [newModId, setNewModId] = useState('');
  const [oldModId, setOldModId] = useState('');
  const [filter, setFilter] = useState<'all' | 'added' | 'removed' | 'changed'>('all');

  const {
    data: diff,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['diff', newModId, oldModId],
    queryFn: () => api.mods.diff(Number(newModId), Number(oldModId)),
    enabled: false, // manual trigger
  });

  /** Carry over translations from old version to new version */
  const carryOver = useMutation({
    mutationFn: () => api.mods.carryOver(Number(newModId), Number(oldModId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diff', newModId, oldModId] });
      refetch();
    },
  });

  const allEntries: DiffEntry[] = diff
    ? [
        ...(filter === 'all' || filter === 'added' ? diff.added : []),
        ...(filter === 'all' || filter === 'removed' ? diff.removed : []),
        ...(filter === 'all' || filter === 'changed' ? diff.changed : []),
      ]
    : [];

  return (
    <div className={s.page}>
      <h1 className={s.title}>Mod Diff</h1>
      <p className={s.subtitle}>
        Compare two mod versions to see added, removed, and changed strings.
      </p>

      {/* Controls */}
      <div className={s.toolbar}>
        <div className={s.fieldCol}>
          <label className={s.label}>New version (updated mod)</label>
          <select value={newModId} onChange={(e) => setNewModId(e.target.value)} className={s.select}>
            <option value="">Select mod…</option>
            {mods?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className={s.fieldCol}>
          <label className={s.label}>Old version (base for comparison)</label>
          <select value={oldModId} onChange={(e) => setOldModId(e.target.value)} className={s.select}>
            <option value="">Select mod…</option>
            {mods?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className={s.fieldCol}>
          <label className={s.label}>&nbsp;</label>
          <button
            onClick={() => refetch()}
            disabled={!newModId || !oldModId || isFetching}
            className={s.btnCompare}
          >
            {isFetching ? 'Comparing…' : 'Compare'}
          </button>
        </div>
      </div>

      {error && <p className={s.error}>Error: {String(error)}</p>}

      {diff && (
        <>
          {/* Summary */}
          <div className={s.summary}>
            {[
              ['added', diff.added.length, '#4caf50'],
              ['removed', diff.removed.length, '#f44336'],
              ['changed', diff.changed.length, '#ff9800'],
              ['unchanged', diff.unchanged, '#555'],
            ].map(([type, count, color]) => (
              <span
                key={type as string}
                className={s.chip}
                style={{ borderColor: color as string, color: color as string, cursor: type !== 'unchanged' ? 'pointer' : 'default' }}
                onClick={() => type !== 'unchanged' && setFilter(filter === type ? 'all' : (type as typeof filter))}
              >
                {CHANGE_LABELS[type as string] ?? type}: {count as number}
              </span>
            ))}
          </div>

          {/* Carry-over button — copies translations from old version to new */}
          <div className={s.carryRow}>
            <button
              onClick={() => carryOver.mutate()}
              disabled={carryOver.isPending}
              className={s.btnCarryOver}
            >
              {carryOver.isPending ? 'Carrying over…' : '⇄ Carry Over Translations'}
            </button>
            {carryOver.data && (
              <span className={s.carryInfo}>
                Carried: <b style={{ color: '#4caf50' }}>{carryOver.data.carried}</b>
                {' · '}Needs review: <b style={{ color: '#ff9800' }}>{carryOver.data.needsReview}</b>
                {' · '}Skipped: <b style={{ color: '#888' }}>{carryOver.data.skipped}</b>
              </span>
            )}
            {carryOver.isError && (
              <span className={s.carryError}>
                Error: {String(carryOver.error)}
              </span>
            )}
          </div>

          {/* Filter buttons */}
          <div className={s.filterRow}>
            {(['all', 'added', 'removed', 'changed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={filter === f ? s.filterBtnActive : s.filterBtn}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Table */}
          {allEntries.length === 0 ? (
            <p className={s.empty}>
              No {filter === 'all' ? 'differences' : filter} entries.
            </p>
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>Change</th>
                  <th className={s.th}>FormID</th>
                  <th className={s.th}>Type</th>
                  <th className={s.th} style={{ minWidth: 220 }}>Source (EN)</th>
                  <th className={s.th} style={{ minWidth: 220 }}>Translation</th>
                  <th className={s.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {allEntries.map((entry, i) => (
                  <tr key={i} style={{ background: CHANGE_COLORS[entry.changeType] ?? 'transparent' }}>
                    <td className={s.tdChange} style={{ color: changeColor(entry.changeType) }}>
                      {entry.changeType}
                    </td>
                    <td className={s.tdFormId}>
                      {entry.formid_hex}
                    </td>
                    <td className={s.tdSig}>{entry.signature}</td>
                    <td className={s.tdText}>
                      {entry.source}
                    </td>
                    <td className={s.tdTransl}>
                      {entry.translation ?? <span className={s.noTransl}>—</span>}
                    </td>
                    <td className={s.td}>
                      <StatusBadge status={entry.status} small />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

const changeColor = (type: string) => {
  return type === 'added' ? '#4caf50' : type === 'removed' ? '#f44336' : '#ff9800';
}

