import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type DiffEntry } from '../../api';
import { StatusBadge } from '../../components/StatusBadge';
import s from './DiffPage.module.scss';

const CHANGE_LABELS: Record<string, string> = {
  added: 'diff.added',
  removed: 'diff.removed',
  changed: 'diff.changed',
};

/** Maps changeType to the CSS Module row-background class. */
const ROW_CLASS: Record<string, string> = {
  added: s.rowAdded,
  removed: s.rowRemoved,
  changed: s.rowChanged,
};

/** Maps changeType to the CSS Module text-color class for the change column. */
const CHANGE_CLASS: Record<string, string> = {
  added: s.changeAdded,
  removed: s.changeRemoved,
  changed: s.changeChanged,
};

export const DiffPage = () => {
  const { t } = useTranslation();
  const { data: mods } = useQuery({ queryKey: ['mods'], queryFn: () => api.mods.list() });
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [newModId, setNewModId] = useState(searchParams.get('newModId') ?? '');
  const [oldModId, setOldModId] = useState(searchParams.get('oldModId') ?? '');
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

  /**
   * Auto-trigger comparison when both mod IDs come from URL params (e.g. after
   * navigating from the ReimportModal).
   */
  useEffect(() => {
    if (searchParams.get('newModId') && searchParams.get('oldModId')) {
      refetch();
    }
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <h1 className={s.title}>{t('diff.title')}</h1>
      <p className={s.subtitle}>
        {t('diff.subtitle')}
      </p>

      {/* Controls */}
      <div className={s.toolbar}>
        <div className={s.fieldCol}>
          <label className={s.label}>{t('diff.newVersion')}</label>
          <select value={newModId} onChange={(e) => setNewModId(e.target.value)} className={s.select}>
            <option value="">{t('diff.selectMod')}</option>
            {mods?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className={s.fieldCol}>
          <label className={s.label}>{t('diff.oldVersion')}</label>
          <select value={oldModId} onChange={(e) => setOldModId(e.target.value)} className={s.select}>
            <option value="">{t('diff.selectMod')}</option>
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
            {isFetching ? t('diff.comparing') : t('diff.compare')}
          </button>
        </div>
      </div>

      {error && <p className={s.error}>{t('common.error', { message: String(error) })}</p>}

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
                {t(CHANGE_LABELS[type as string] ?? `diff.${type as string}`)}: {count as number}
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
              {carryOver.isPending ? t('diff.carryingOver') : t('diff.carryOver')}
            </button>
            {carryOver.data && (
              <span className={s.carryInfo}>
                {t('diff.carried')}: <b className={s.carryGreen}>{carryOver.data.carried}</b>
                {' · '}{t('diff.needsReview')}: <b className={s.carryOrange}>{carryOver.data.needsReview}</b>
                {' · '}{t('diff.skipped')}: <b className={s.carryGrey}>{carryOver.data.skipped}</b>
              </span>
            )}
            {/* After carry-over, offer a direct link to the new mod's editor filtered to drafts */}
            {carryOver.isSuccess && carryOver.data && carryOver.data.needsReview > 0 && newModId && (
              <Link
                to={`/games/${mods?.find(m => m.id === Number(newModId))?.game ?? 'fo4'}/mods/${newModId}?status=draft`}
                className={s.btnOpenEditor}
                title={t('diff.openInEditorTitle')}
              >
                {t('diff.openInEditor', { count: carryOver.data.needsReview })}
              </Link>
            )}
            {carryOver.isError && (
              <span className={s.carryError}>
                {t('common.error', { message: String(carryOver.error) })}
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
              {t('diff.noDifferences', { filter: filter === 'all' ? t('diff.filterAll') : filter })}
            </p>
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>{t('diff.change')}</th>
                  <th className={s.th}>{t('modEditor.formId')}</th>
                  <th className={s.th}>{t('diff.type')}</th>
                  <th className={s.thWide}>{t('diff.sourceEn')}</th>
                  <th className={s.thWide}>{t('diff.translation')}</th>
                  <th className={s.th}>{t('csvImport.statusCol')}</th>
                </tr>
              </thead>
              <tbody>
                {allEntries.map((entry, i) => (
                  <tr key={i} className={ROW_CLASS[entry.changeType] ?? ''}>
                    <td className={`${s.tdChange} ${CHANGE_CLASS[entry.changeType] ?? ''}`}>
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


