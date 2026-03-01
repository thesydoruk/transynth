import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { BigCard } from './BigCard';
import { ISSUE_COLORS, pct } from './homeUtils';
import s from './HomePage.module.scss';

interface ProjectStatsProps {
  data: Awaited<ReturnType<typeof api.stats.dashboard>>;
}

/** Project-wide translation totals and QA summary cards. */
export const ProjectStats = ({ data }: ProjectStatsProps) => {
  const { t } = useTranslation();
  const totals = data.mods.reduce(
    (acc, mod) => ({
      total: acc.total + Number(mod.total),
      translated: acc.translated + Number(mod.translated),
      approved: acc.approved + Number(mod.approved) + Number(mod.reviewed),
      draft: acc.draft + Number(mod.draft),
      auto: acc.auto + Number(mod.auto),
      qa: acc.qa + Number(mod.qa_issues),
    }),
    { total: 0, translated: 0, approved: 0, draft: 0, auto: 0, qa: 0 },
  );
  const totalQA = data.qaByType.reduce((sum, row) => sum + Number(row.count), 0);

  return (
    <section className={s.section}>
      <div className={s.bigCards}>
        <BigCard label={t('dashboard.cardStrings')} value={totals.total} />
        <BigCard label={t('dashboard.cardTranslated')} value={totals.translated} sub={`${pct(totals.translated, totals.total)}%`} color="#4caf50" />
        <BigCard label={t('dashboard.cardApproved')} value={totals.approved} sub={`${pct(totals.approved, totals.total)}%`} color="#2196f3" />
        <BigCard label={t('dashboard.cardQaIssues')} value={totalQA} color={totalQA > 0 ? '#e55' : '#4caf50'} />
        {totals.auto > 0 && <BigCard label={t('home.autoTranslated')} value={totals.auto} color="#a78bfa" />}
      </div>
      {data.qaByType.length > 0 && (
        <div className={s.qaStrip}>
          {data.qaByType.map((row) => (
            <span key={row.issue_type} className={s.qaChip} style={{ '--chip-color': ISSUE_COLORS[row.issue_type] ?? '#888' } as React.CSSProperties}>
              {row.issue_type.replace(/_/g, ' ')} <strong>{row.count}</strong>
            </span>
          ))}
        </div>
      )}
    </section>
  );
};