import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type GrupStatRow } from '../../api';
import { Bar } from './Bar';
import { pct } from './homeUtils';
import s from './HomePage.module.scss';

interface GrupSubTableProps {
  modId: number;
}

/** GRUP breakdown sub-table rendered inside an expanded mod row. */
export const GrupSubTable = ({ modId }: GrupSubTableProps) => {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['grupStats', modId],
    queryFn: () => api.stats.grup(modId),
  });

  if (isLoading) return <div className={s.grupLoading}>{t('dashboard.loadingGrup')}</div>;
  if (!data || data.length === 0)
    return <div className={s.grupLoading}>{t('dashboard.noGrupData')}</div>;

  const maxTotal = Math.max(...data.map((row: GrupStatRow) => row.total), 1);

  return (
    <table className={s.grupTable}>
      <thead>
        <tr>
          <th className={s.grupTh}>{t('dashboard.grupSignature')}</th>
          <th className={s.grupThR}>{t('dashboard.thStrings')}</th>
          <th className={s.grupThR}>{t('dashboard.thTranslated')}</th>
          <th className={s.grupThR}>%</th>
          <th className={s.grupThProgress}>{t('mods.progress')}</th>
          <th className={s.grupThR}>{t('dashboard.thApproved')}</th>
          <th className={s.grupThR}>{t('dashboard.thDraft')}</th>
          <th className={s.grupThR}>{t('dashboard.thTm')}</th>
          <th className={s.grupThR}>{t('dashboard.thAuto')}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row: GrupStatRow) => {
          const progress = pct(row.translated, row.total);
          return (
            <tr key={row.signature} className={s.grupDataRow}>
              <td className={s.grupSig}>{row.signature}</td>
              <td className={s.grupTdR}>{row.total}</td>
              <td className={s.grupTdR}>{row.translated}</td>
              <td className={s.grupTdR}>{progress}%</td>
              <td className={s.grupTdProgress}>
                <Bar
                  value={row.translated}
                  max={maxTotal}
                  color={progress === 100 ? '#4caf50' : '#2196f3'}
                />
              </td>
              <td className={s.grupTdR}>{row.approved}</td>
              <td className={s.grupTdR}>{row.draft}</td>
              <td className={s.grupTdR}>{row.tm}</td>
              <td className={s.grupTdR}>{row.auto}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
