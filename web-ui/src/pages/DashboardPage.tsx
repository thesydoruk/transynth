import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { DashboardModRow } from '../api';
import s from './DashboardPage.module.scss';

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

/** Mini horizontal bar chart for a single metric. */
const Bar = ({ value, max, color }: { value: number; max: number; color: string }) => {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className={s.barTrack}>
      <div className={s.barFill} style={{ background: color, width: `${w}%` }} />
    </div>
  );
};

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
  const nav = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.stats.dashboard,
  });

  if (isLoading) return <div className={s.center}>Loading dashboard…</div>;
  if (error) return <div className={`${s.center} ${s.error}`}>Error: {String(error)}</div>;
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
      <h1 className={s.title}>Dashboard</h1>

      {/* Summary cards */}
      <div className={s.cards}>
        <Card label="Strings" value={totals.total} />
        <Card label="Translated" value={totals.translated} sub={`${pct(totals.translated, totals.total)}%`} color="#4caf50" />
        <Card label="Approved" value={totals.approved + totals.reviewed} sub={`${pct(totals.approved + totals.reviewed, totals.total)}%`} color="#2196f3" />
        <Card label="QA Issues" value={totalQA} color={totalQA > 0 ? '#e55' : '#4caf50'} />
      </div>

      {/* QA breakdown */}
      {data.qaByType.length > 0 && (
        <section className={s.section}>
          <h2 className={s.h2}>QA Issue Breakdown</h2>
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
        <h2 className={s.h2}>Mods</h2>
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th}>Mod</th>
              <th className={s.thR}>Strings</th>
              <th className={s.thR}>Translated</th>
              <th className={s.thR}>%</th>
              <th className={s.thProgress}>Progress</th>
              <th className={s.thR}>Approved</th>
              <th className={s.thR}>Draft</th>
              <th className={s.thR}>TM</th>
              <th className={s.thR}>Auto</th>
              <th className={s.thR}>QA</th>
            </tr>
          </thead>
          <tbody>
            {data.mods.map((m: DashboardModRow) => {
              const p = pct(Number(m.translated), Number(m.total));
              return (
                <tr
                  key={m.id}
                  className={s.tr}
                  onClick={() => nav(`/mods/${m.id}`)}
                >
                  <td className={s.td}>{m.name}</td>
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
              );
            })}
          </tbody>
          {data.mods.length > 1 && (
            <tfoot>
              <tr className={s.tfoot}>
                <td className={s.td}>Total</td>
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

/** Summary stat card shown at the top of the dashboard. */
const Card = ({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) => (
  <div className={s.card} style={{ '--card-color': color ?? '#fff' } as React.CSSProperties}>
    <div className={s.cardValue}>{value.toLocaleString()}</div>
    <div className={s.cardLabel}>
      {label}
      {sub && <span className={s.cardSub}>{sub}</span>}
    </div>
  </div>
);


