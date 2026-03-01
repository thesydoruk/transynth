import { useTranslation } from 'react-i18next';
import type { OpsOverview, OpsTableSize } from '../../api';
import { MiniCard } from './MiniCard';
import s from './OpsPage.module.scss';

interface DbSectionProps {
  data: OpsOverview;
}

/** Database size metrics: total size and per-table breakdown. */
export const DbSection = ({ data }: DbSectionProps) => {
  const { t } = useTranslation();
  const db = data.db;

  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('ops.database')}</h2>
      <div className={s.cards}>
        <MiniCard label={t('ops.totalDbSize')} value={db.totalSize} />
      </div>
      <table className={s.compactTable}>
        <thead>
          <tr>
            <th className={s.th}>{t('ops.tableName')}</th>
            <th className={s.thR}>{t('ops.rows')}</th>
            <th className={s.thR}>{t('ops.diskSize')}</th>
          </tr>
        </thead>
        <tbody>
          {db.tables.map((table: OpsTableSize) => (
            <tr key={table.table_name} className={s.tr}>
              <td className={s.tdMono}>{table.table_name}</td>
              <td className={s.tdR}>{Number(table.row_count).toLocaleString()}</td>
              <td className={s.tdR}>{table.size}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};