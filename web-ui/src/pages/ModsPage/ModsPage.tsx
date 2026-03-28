import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { ConfirmModal } from '../../components/ConfirmModal';
import { ProgressBar, StatusBadge } from '../../components/StatusBadge';
import { Toast } from '../../components/Toast';
import { Button } from '../../components/Button';
import s from './ModsPage.module.scss';

/**
 * ModsPage — imported mods list scoped to a single game.
 * URL: /games/:gameId/mods
 * Fetches mods filtered by gameId and renders a progress table.
 */
export const ModsPage = () => {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { gameId = '' } = useParams<{ gameId: string }>();
  const [pendingClear, setPendingClear] = useState<{ id: number; name: string } | null>(null);
  const [clearingModId, setClearingModId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['mods', gameId],
    queryFn: () => api.mods.list(gameId),
  });

  const confirmClearRows = async () => {
    if (!pendingClear) return;
    setClearingModId(pendingClear.id);
    try {
      const result = await api.mods.clearRows(pendingClear.id);
      await qc.invalidateQueries({ queryKey: ['mods', gameId] });
      setToast({ message: t('mods.clearRowsSuccess', { count: result.deletedRecords }), type: 'success' });
      setPendingClear(null);
    } catch (err) {
      setToast({ message: t('common.error', { message: String(err) }), type: 'error' });
    } finally {
      setClearingModId(null);
    }
  };

  if (isLoading) return <div className={s.center}>{t('mods.loadingMods')}</div>;
  if (error) return <div className={`${s.center} ${s.error}`}>{t('common.error', { message: String(error) })}</div>;
  if (!data?.length)
    return (
      <div className={s.center}>
        <h2>{t('mods.noModsFound')}</h2>
        <p className={s.hintText}>
          {t('mods.noModsHint')}
        </p>
      </div>
    );

  return (
    <div className={s.page}>
      <div className={s.breadcrumb}>
        <Link to={`/games/${gameId}`}>{`\u2190 ${gameId.toUpperCase()}`}</Link>
      </div>
      <h1 className={s.title}>{t('mods.title')}</h1>
      <table className={s.table}>
        <thead>
          <tr>
            <th className={s.th}>{t('mods.name')}</th>
            <th className={s.th}>{t('mods.strings')}</th>
            <th className={s.th}>{t('mods.progress')}</th>
            <th className={s.th}>{t('mods.approved')}</th>
            <th className={s.th}>{t('mods.fuzzy')}</th>
            <th className={s.th}>{t('mods.actions')}</th>
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
                onClick={() => nav(`/games/${gameId}/mods/${mod.id}`)}
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
                <td className={s.td}>
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingClear({ id: mod.id, name: mod.name });
                    }}
                    disabled={clearingModId === mod.id}
                    title={t('mods.clearRowsTitle')}
                  >
                    {clearingModId === mod.id ? t('mods.clearingRows') : t('mods.clearRows')}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {pendingClear && (
        <ConfirmModal
          title={t('mods.clearRowsTitle')}
          message={t('mods.clearRowsMessage', { name: pendingClear.name })}
          confirmLabel={t('mods.clearRows')}
          pending={clearingModId === pendingClear.id}
          onClose={() => setPendingClear(null)}
          onConfirm={() => { void confirmClearRows(); }}
        />
      )}

      <Toast
        message={toast?.message ?? null}
        type={toast?.type ?? 'info'}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}


