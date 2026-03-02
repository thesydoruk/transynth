import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type DashboardModRow } from '../../../api';
import { Bar } from '../Bar';
import { GrupSubTable } from '../GrupSubTable';
import { pct } from '../homeUtils';
import s from '../HomePage.module.scss';

interface ModProgressSectionProps {
  data: Awaited<ReturnType<typeof api.stats.dashboard>>;
}

/** Per-mod progress table with expandable GRUP breakdown rows. */
export const ModProgressSection = ({ data }: ModProgressSectionProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<number | null>(null);
  const totals = data.mods.reduce(
    (acc, mod) => ({
      total: acc.total + Number(mod.total),
      translated: acc.translated + Number(mod.translated),
      approved: acc.approved + Number(mod.approved) + Number(mod.reviewed),
      draft: acc.draft + Number(mod.draft),
      tm: acc.tm + Number(mod.tm) + Number(mod.fuzzy),
      auto: acc.auto + Number(mod.auto),
      qa: acc.qa + Number(mod.qa_issues),
    }),
    { total: 0, translated: 0, approved: 0, draft: 0, tm: 0, auto: 0, qa: 0 },
  );

  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('dashboard.mods')}</h2>
      <table className={s.table}>
        <thead>
          <tr>
            <th className={s.thExpand} />
            <th className={s.th}>{t('dashboard.mod')}</th>
            <th className={s.thR}>{t('dashboard.thStrings')}</th>
            <th className={s.thR}>{t('dashboard.thTranslated')}</th>
            <th className={s.thR}>%</th>
            <th className={s.thProgress}>{t('mods.progress')}</th>
            <th className={s.thR}>{t('dashboard.thApproved')}</th>
            <th className={s.thR}>{t('dashboard.thDraft')}</th>
            <th className={s.thR}>{t('dashboard.thTm')}</th>
            <th className={s.thR}>{t('dashboard.thAuto')}</th>
            <th className={s.thR}>{t('dashboard.thQa')}</th>
          </tr>
        </thead>
        <tbody>
          {data.mods.map((mod: DashboardModRow) => {
            const progress = pct(Number(mod.translated), Number(mod.total));
            const isOpen = expanded === mod.id;
            return (
              <>
                <tr key={mod.id} className={s.tr} onClick={() => setExpanded(isOpen ? null : mod.id)}>
                  <td className={s.tdExpand}>{isOpen ? '▾' : '▸'}</td>
                  <td className={s.td}>
                    <Link to={`/games/${mod.game}/mods/${mod.id}`} className={s.modLink} onClick={(event) => event.stopPropagation()}>
                      {mod.name}
                    </Link>
                  </td>
                  <td className={s.tdR}>{mod.total}</td>
                  <td className={s.tdR}>{mod.translated}</td>
                  <td className={s.tdR}>{progress}%</td>
                  <td className={s.td}><Bar value={Number(mod.translated)} max={Number(mod.total)} color={progress === 100 ? '#4caf50' : '#2196f3'} /></td>
                  <td className={s.tdR}>{Number(mod.approved) + Number(mod.reviewed)}</td>
                  <td className={s.tdR}>{mod.draft}</td>
                  <td className={s.tdR}>{Number(mod.tm) + Number(mod.fuzzy)}</td>
                  <td className={s.tdR}>{mod.auto}</td>
                  <td className={Number(mod.qa_issues) > 0 ? s.qaHasIssues : s.qaNoIssues}>{mod.qa_issues}</td>
                </tr>
                {isOpen && (
                  <tr key={`${mod.id}-grup`} className={s.grupRow}>
                    <td colSpan={11} className={s.grupCell}><GrupSubTable modId={mod.id} /></td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
        {data.mods.length > 1 && (
          <tfoot>
            <tr className={s.tfoot}>
              <td />
              <td className={s.td}>{t('dashboard.total')}</td>
              <td className={s.tdR}>{totals.total}</td>
              <td className={s.tdR}>{totals.translated}</td>
              <td className={s.tdR}>{pct(totals.translated, totals.total)}%</td>
              <td className={s.td}><Bar value={totals.translated} max={totals.total} color="#2196f3" /></td>
              <td className={s.tdR}>{totals.approved}</td>
              <td className={s.tdR}>{totals.draft}</td>
              <td className={s.tdR}>{totals.tm}</td>
              <td className={s.tdR}>{totals.auto}</td>
              <td className={totals.qa > 0 ? s.qaHasIssues : s.qaNoIssues}>{totals.qa}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );
};
