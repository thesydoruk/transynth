import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpsOverview, OpsTableSize } from '../../api';
import { SmCard } from './SmCard';
import s from './HomePage.module.scss';

interface TechDetailsSectionProps {
  data: OpsOverview;
}

/** Collapsible LLM and database diagnostics section for the overview page. */
export const TechDetailsSection = ({ data }: TechDetailsSectionProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <section className={s.section}>
      <button className={s.collapseToggle} onClick={() => setOpen((value) => !value)}>
        {open ? '▾' : '▸'} {t('home.techDetails')}
      </button>

      {open && (
        <div className={s.techGrid}>
          <div>
            <h3 className={s.h3}>{t('ops.llm')}</h3>
            <div className={s.smCards}>
              <SmCard label={t('ops.cacheEntries')} value={data.llm.cacheEntries.toLocaleString()} />
              <SmCard label={t('ops.autoTranslated')} value={data.llm.autoTranslated.toLocaleString()} />
            </div>
            {data.llm.byModel.length > 0 && (
              <table className={s.compactTable}>
                <thead>
                  <tr>
                    <th className={s.th}>{t('ops.model')}</th>
                    <th className={s.thR}>{t('ops.count')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.llm.byModel.map((model) => (
                    <tr key={model.model} className={s.tr}>
                      <td className={s.tdMono}>{model.model}</td>
                      <td className={s.tdR}>{model.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h3 className={s.h3}>{t('ops.database')}</h3>
            <div className={s.smCards}>
              <SmCard label={t('ops.totalDbSize')} value={data.db.totalSize} />
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
                {data.db.tables.map((table: OpsTableSize) => (
                  <tr key={table.table_name} className={s.tr}>
                    <td className={s.tdMono}>{table.table_name}</td>
                    <td className={s.tdR}>{Number(table.row_count).toLocaleString()}</td>
                    <td className={s.tdR}>{table.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};