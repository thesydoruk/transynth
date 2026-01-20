import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { DashboardModRow } from '../api';

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

const Bar = ({ value, max, color }: { value: number; max: number; color: string }) => {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ background: '#222', borderRadius: 4, height: 14, flex: 1, minWidth: 60 }}>
      <div style={{ background: color, borderRadius: 4, height: '100%', width: `${w}%`, transition: 'width .3s' }} />
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

  if (isLoading) return <div style={s.center}>Loading dashboard…</div>;
  if (error) return <div style={{ ...s.center, color: '#f44' }}>Error: {String(error)}</div>;
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
    <div style={s.page}>
      <h1 style={s.title}>Dashboard</h1>

      {/* Summary cards */}
      <div style={s.cards}>
        <Card label="Strings" value={totals.total} />
        <Card label="Translated" value={totals.translated} sub={`${pct(totals.translated, totals.total)}%`} color="#4caf50" />
        <Card label="Approved" value={totals.approved + totals.reviewed} sub={`${pct(totals.approved + totals.reviewed, totals.total)}%`} color="#2196f3" />
        <Card label="QA Issues" value={totalQA} color={totalQA > 0 ? '#e55' : '#4caf50'} />
      </div>

      {/* QA breakdown */}
      {data.qaByType.length > 0 && (
        <section style={s.section}>
          <h2 style={s.h2}>QA Issue Breakdown</h2>
          <div style={s.qaGrid}>
            {data.qaByType.map((r) => (
              <div key={r.issue_type} style={s.qaRow}>
                <span style={{ ...s.qaLabel, color: ISSUE_COLORS[r.issue_type] ?? '#aaa' }}>
                  {issueLabel(r.issue_type)}
                </span>
                <Bar value={Number(r.count)} max={totalQA} color={ISSUE_COLORS[r.issue_type] ?? '#888'} />
                <span style={s.qaCount}>{r.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Per-mod table */}
      <section style={s.section}>
        <h2 style={s.h2}>Mods</h2>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Mod</th>
              <th style={s.thR}>Strings</th>
              <th style={s.thR}>Translated</th>
              <th style={s.thR}>%</th>
              <th style={{ ...s.th, minWidth: 120 }}>Progress</th>
              <th style={s.thR}>Approved</th>
              <th style={s.thR}>Draft</th>
              <th style={s.thR}>TM</th>
              <th style={s.thR}>Auto</th>
              <th style={s.thR}>QA</th>
            </tr>
          </thead>
          <tbody>
            {data.mods.map((m: DashboardModRow) => {
              const p = pct(Number(m.translated), Number(m.total));
              return (
                <tr
                  key={m.id}
                  style={s.tr}
                  onClick={() => nav(`/mods/${m.id}`)}
                >
                  <td style={s.td}>{m.name}</td>
                  <td style={s.tdR}>{m.total}</td>
                  <td style={s.tdR}>{m.translated}</td>
                  <td style={s.tdR}>{p}%</td>
                  <td style={s.td}>
                    <Bar value={Number(m.translated)} max={Number(m.total)} color={p === 100 ? '#4caf50' : '#2196f3'} />
                  </td>
                  <td style={s.tdR}>{Number(m.approved) + Number(m.reviewed)}</td>
                  <td style={s.tdR}>{m.draft}</td>
                  <td style={s.tdR}>{Number(m.tm) + Number(m.fuzzy)}</td>
                  <td style={s.tdR}>{m.auto}</td>
                  <td style={{ ...s.tdR, color: Number(m.qa_issues) > 0 ? '#e55' : '#666' }}>
                    {m.qa_issues}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {data.mods.length > 1 && (
            <tfoot>
              <tr style={s.tfoot}>
                <td style={s.td}>Total</td>
                <td style={s.tdR}>{totals.total}</td>
                <td style={s.tdR}>{totals.translated}</td>
                <td style={s.tdR}>{pct(totals.translated, totals.total)}%</td>
                <td style={s.td}>
                  <Bar value={totals.translated} max={totals.total} color="#2196f3" />
                </td>
                <td style={s.tdR}>{totals.approved + totals.reviewed}</td>
                <td style={s.tdR}>{totals.draft}</td>
                <td style={s.tdR}>{totals.tm + totals.fuzzy}</td>
                <td style={s.tdR}>{totals.auto}</td>
                <td style={{ ...s.tdR, color: totals.qa > 0 ? '#e55' : '#666' }}>{totals.qa}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    </div>
  );
};

const Card = ({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) => (
  <div style={s.card}>
    <div style={{ fontSize: 28, fontWeight: 700, color: color ?? '#fff' }}>{value.toLocaleString()}</div>
    <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>
      {label}
      {sub && <span style={{ marginLeft: 6, color: color ?? '#aaa', fontWeight: 600 }}>{sub}</span>}
    </div>
  </div>
);

const s: Record<string, React.CSSProperties> = {
  page: { padding: '24px 32px', maxWidth: 1200, margin: '0 auto' },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: '#888' },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 20, color: '#eee' },
  cards: { display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' as const },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '16px 24px', minWidth: 140 },
  section: { marginBottom: 32 },
  h2: { fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#ccc' },
  qaGrid: { display: 'flex', flexDirection: 'column' as const, gap: 6, maxWidth: 500 },
  qaRow: { display: 'flex', alignItems: 'center', gap: 10 },
  qaLabel: { fontSize: 13, minWidth: 160, textTransform: 'capitalize' as const },
  qaCount: { fontSize: 13, color: '#aaa', minWidth: 36, textAlign: 'right' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 10px', borderBottom: '1px solid #333', color: '#888', fontWeight: 600 },
  thR: { textAlign: 'right' as const, padding: '8px 10px', borderBottom: '1px solid #333', color: '#888', fontWeight: 600 },
  tr: { cursor: 'pointer', borderBottom: '1px solid #222' },
  td: { padding: '8px 10px', color: '#ccc' },
  tdR: { padding: '8px 10px', color: '#ccc', textAlign: 'right' as const },
  tfoot: { borderTop: '2px solid #333', fontWeight: 600 },
};
