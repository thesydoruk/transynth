import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpsOverview, OpsTableSize } from '../../../api';
import { SmCard } from '../SmCard';
import parentS from '../HomePage.module.scss';
import s from './TechDetailsSection.module.scss';

interface TechDetailsSectionProps {
  data: OpsOverview;
}

/** Collapsible LLM and database diagnostics section for the overview page. */
export const TechDetailsSection = ({ data }: TechDetailsSectionProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <section className={parentS.section}>
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
              <table className={parentS.compactTable}>
                <thead>
                  <tr>
                    <th className={parentS.th}>{t('ops.model')}</th>
                    <th className={parentS.thR}>{t('ops.count')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.llm.byModel.map((model) => (
                    <tr key={model.model} className={parentS.tr}>
                      <td className={parentS.tdMono}>{model.model}</td>
                      <td className={parentS.tdR}>{model.count.toLocaleString()}</td>
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
            <table className={parentS.compactTable}>
              <thead>
                <tr>
                  <th className={parentS.th}>{t('ops.tableName')}</th>
                  <th className={parentS.thR}>{t('ops.rows')}</th>
                  <th className={parentS.thR}>{t('ops.diskSize')}</th>
                </tr>
              </thead>
              <tbody>
                {data.db.tables.map((table: OpsTableSize) => (
                  <tr key={table.table_name} className={parentS.tr}>
                    <td className={parentS.tdMono}>{table.table_name}</td>
                    <td className={parentS.tdR}>{Number(table.row_count).toLocaleString()}</td>
                    <td className={parentS.tdR}>{table.size}</td>
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
