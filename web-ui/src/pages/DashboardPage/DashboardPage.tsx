import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { DashboardModRow } from '../../api';
import { Bar } from './Bar';
import { DashboardCard } from './DashboardCard';
import { GrupSubTable } from './GrupSubTable';
import s from './DashboardPage.module.scss';

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

const ISSUE_COLORS: Record<string, string> = {
  placeholder_mismatch: '#e55',
  empty_translation: '#e55',
  forbidden_chars: '#e55',
  same_as_source: '#e8a735',
  length_delta: '#e8a735',
  glossary_violation: '#e8a735',
  duplicate_inconsistency: '#7ab',
};

const issueLabel = (t: string) => t.replace(/_/g, ' ');

export const DashboardPage = () => {
  const { t } = useTranslation();
  /** ID of the mod whose GRUP breakdown is currently expanded (null = none). */
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.stats.dashboard,
  });

  if (isLoading) return <div className={s.center}>{t('dashboard.loadingDashboard')}</div>;
  if (error) return <div className={`${s.center} ${s.error}`}>{t('common.error', { message: String(error) })}</div>;
  if (!data) return null;

  const totals = data.mods.reduce(
    (acc, m) => ({
      total: acc.total + Number(m.total),
      translated: acc.translated + Number(m.translated),
      approved: acc.approved + Number(m.approved),
      reviewed: acc.reviewed + Number(m.reviewed),
      draft: acc.draft + Number(m.draft),
      tm: acc.tm + Number(m.tm),
      fuzzy: acc.fuzzy + Number(m.fuzzy),
      auto: acc.auto + Number(m.auto),
      rejected: acc.rejected + Number(m.rejected),
      qa: acc.qa + Number(m.qa_issues),
    }),
    { total: 0, translated: 0, approved: 0, reviewed: 0, draft: 0, tm: 0, fuzzy: 0, auto: 0, rejected: 0, qa: 0 },
  );

  const totalQA = data.qaByType.reduce((s, r) => s + Number(r.count), 0);

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('dashboard.title')}</h1>

      {/* Summary cards */}
      <div className={s.cards}>
        <DashboardCard label={t('dashboard.cardStrings')} value={totals.total} />
        <DashboardCard label={t('dashboard.cardTranslated')} value={totals.translated} sub={`${pct(totals.translated, totals.total)}%`} color="#4caf50" />
        <DashboardCard label={t('dashboard.cardApproved')} value={totals.approved + totals.reviewed} sub={`${pct(totals.approved + totals.reviewed, totals.total)}%`} color="#2196f3" />
        <DashboardCard label={t('dashboard.cardQaIssues')} value={totalQA} color={totalQA > 0 ? '#e55' : '#4caf50'} />
      </div>

      {/* QA breakdown */}
      {data.qaByType.length > 0 && (
        <section className={s.section}>
          <h2 className={s.h2}>{t('dashboard.qaBreakdown')}</h2>
          <div className={s.qaGrid}>
            {data.qaByType.map((r) => (
              <div key={r.issue_type} className={s.qaRow}>
                <span className={s.qaLabel} style={{ '--label-color': ISSUE_COLORS[r.issue_type] ?? '#aaa' } as React.CSSProperties}>
                  {issueLabel(r.issue_type)}
                </span>
                <Bar value={Number(r.count)} max={totalQA} color={ISSUE_COLORS[r.issue_type] ?? '#888'} />
                <span className={s.qaCount}>{r.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Per-mod table */}
      <section className={s.section}>
        <h2 className={s.h2}>{t('dashboard.mods')}</h2>
        <table className={s.table}>
          <thead>
            <tr>
              {/* Extra column for the expand toggle */}
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
            {data.mods.map((m: DashboardModRow) => {
              const p = pct(Number(m.translated), Number(m.total));
              const isOpen = expanded === m.id;
              return (
                <>
                  <tr key={m.id} className={s.tr}>
                    {/* Expand / collapse toggle */}
                    <td
                      className={s.tdExpand}
                      onClick={() => setExpanded(isOpen ? null : m.id)}
                      title={t(isOpen ? 'dashboard.collapseGrup' : 'dashboard.expandGrup')}
                    >
                      {isOpen ? '▾' : '▸'}
                    </td>
                    {/* Mod name links to its editor */}
                    <td className={s.td}>
                      <Link
                        to={`/games/${m.game}/mods/${m.id}`}
                        className={s.modLink}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {m.name}
                      </Link>
                    </td>
                    <td className={s.tdR}>{m.total}</td>
                    <td className={s.tdR}>{m.translated}</td>
                    <td className={s.tdR}>{p}%</td>
                    <td className={s.td}>
                      <Bar value={Number(m.translated)} max={Number(m.total)} color={p === 100 ? '#4caf50' : '#2196f3'} />
                    </td>
                    <td className={s.tdR}>{Number(m.approved) + Number(m.reviewed)}</td>
                    <td className={s.tdR}>{m.draft}</td>
                    <td className={s.tdR}>{Number(m.tm) + Number(m.fuzzy)}</td>
                    <td className={s.tdR}>{m.auto}</td>
                    <td className={Number(m.qa_issues) > 0 ? s.qaHasIssues : s.qaNoIssues}>
                      {m.qa_issues}
                    </td>
                  </tr>
                  {/* GRUP breakdown sub-row — rendered only when expanded */}
                  {isOpen && (
                    <tr key={`${m.id}-grup`} className={s.grupRow}>
                      <td colSpan={11} className={s.grupCell}>
                        <GrupSubTable modId={m.id} />
                      </td>
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
                <td className={s.td}>
                  <Bar value={totals.translated} max={totals.total} color="#2196f3" />
                </td>
                <td className={s.tdR}>{totals.approved + totals.reviewed}</td>
                <td className={s.tdR}>{totals.draft}</td>
                <td className={s.tdR}>{totals.tm + totals.fuzzy}</td>
                <td className={s.tdR}>{totals.auto}</td>
                <td className={totals.qa > 0 ? s.qaHasIssues : s.qaNoIssues}>{totals.qa}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    </div>
  );
};

