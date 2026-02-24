/**
 * HomePage — merged project Overview.
 *
 * Combines the former Dashboard (translation progress, mod stats, QA summary)
 * and Health/Ops (system status, import jobs, LLM cache, database sizes) into
 * one page.  Data is laid out in a natural top-to-bottom reading order:
 *
 *   1. Project stats   — total strings, translation/approval progress, QA count
 *   2. System status   — uptime, DB connectivity, memory (compact strip)
 *   3. Mod progress    — per-mod table with GRUP breakdown (from Dashboard)
 *   4. Recent imports  — last import jobs (from Ops)
 *   5. QA breakdown    — QA issues by type (from Dashboard)
 *   6. LLM & Database  — cache stats + table sizes (from Ops, collapsed by default)
 *
 * Navigation to this page: click the "FO4 Localizer" brand in the top bar.
 * No nav link is shown for this page.
 *
 * Both datasets auto-refresh: Dashboard every 60 s, Ops every 30 s.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { DashboardModRow, GrupStatRow, OpsImportJob, OpsOverview, OpsTableSize } from '../api';
import s from './HomePage.module.scss';

/* ── helpers ─────────────────────────────────────────────────────────────── */

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

const fmtBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const fmtUptime = (sec: number): string => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const sRem = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sRem}s`;
  return `${m}m ${sRem}s`;
};

const jobPct = (j: OpsImportJob) =>
  j.total_records > 0 ? Math.round((j.imported_records / j.total_records) * 100) : 0;

const kindLabel = (kind: 'eet' | 'csv' | 'mod') =>
  kind === 'eet' ? 'EET' : kind === 'csv' ? 'CSV' : 'MOD';

const jobStatusClass = (status: string, css: Record<string, string>): string => {
  switch (status) {
    case 'completed': return css.badgeOk!;
    case 'failed': return css.badgeErr!;
    case 'in_progress':
    case 'extracting': return css.badgeRun!;
    case 'paused': return css.badgeWarn!;
    default: return css.badgeDim!;
  }
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

/* ── mini components ─────────────────────────────────────────────────────── */

/** Large summary card (project stats). */
const BigCard = ({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color?: string;
}) => (
  <div className={s.bigCard} style={color ? { '--card-color': color } as React.CSSProperties : undefined}>
    <div className={s.bigCardValue}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
    <div className={s.bigCardLabel}>
      {label}
      {sub && <span className={s.bigCardSub}> {sub}</span>}
    </div>
  </div>
);

/** Small system-status card (Ops strip). */
const SmCard = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div className={s.smCard} style={color ? { '--card-color': color } as React.CSSProperties : undefined}>
    <span className={s.smCardValue}>{value}</span>
    <span className={s.smCardLabel}>{label}</span>
  </div>
);

/** Horizontal progress bar. */
const Bar = ({ value, max, color }: { value: number; max: number; color: string }) => {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className={s.barTrack}>
      <div className={s.barFill} style={{ background: color, width: `${w}%` }} />
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * HomePage — combined project overview and health dashboard.
 */
export const HomePage = () => {
  const { t } = useTranslation();

  const { data: dash, isLoading: dashLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.stats.dashboard,
    refetchInterval: 60_000,
  });

  const { data: ops, isLoading: opsLoading } = useQuery({
    queryKey: ['ops'],
    queryFn: api.ops.overview,
    refetchInterval: 30_000,
  });

  if (dashLoading || opsLoading) {
    return <div className={s.loading}>{t('common.loading')}</div>;
  }

  return (
    <div className={s.page}>

      {/* ══ 1. Project stats ═════════════════════════════════════════════ */}
      {dash && <ProjectStats data={dash} />}

      {/* ══ 2. System status strip (Ops) ════════════════════════════════ */}
      {ops && <SystemStrip data={ops} t={t} />}

      {/* ══ 3. Mod progress table (Dashboard) ═══════════════════════════ */}
      {dash && <ModProgressSection data={dash} />}

      {/* ══ 4. Recent imports (Ops) ══════════════════════════════════════ */}
      {ops && <RecentImports jobs={ops.importJobs} />}

      {/* ══ 5. LLM cache + DB stats (Ops) — collapsible ═════════════════ */}
      {ops && <TechDetailsSection data={ops} />}

    </div>
  );
};

/* ── 1. Project stats ────────────────────────────────────────────────────── */

const ProjectStats = ({ data }: { data: Awaited<ReturnType<typeof api.stats.dashboard>> }) => {
  const { t } = useTranslation();

  const totals = data.mods.reduce(
    (acc, m) => ({
      total:      acc.total + Number(m.total),
      translated: acc.translated + Number(m.translated),
      approved:   acc.approved + Number(m.approved) + Number(m.reviewed),
      draft:      acc.draft + Number(m.draft),
      auto:       acc.auto + Number(m.auto),
      qa:         acc.qa + Number(m.qa_issues),
    }),
    { total: 0, translated: 0, approved: 0, draft: 0, auto: 0, qa: 0 },
  );

  const totalQA = data.qaByType.reduce((sum, r) => sum + Number(r.count), 0);

  return (
    <section className={s.section}>
      {/* Summary cards row */}
      <div className={s.bigCards}>
        <BigCard label={t('dashboard.cardStrings')} value={totals.total} />
        <BigCard
          label={t('dashboard.cardTranslated')}
          value={totals.translated}
          sub={`${pct(totals.translated, totals.total)}%`}
          color="#4caf50"
        />
        <BigCard
          label={t('dashboard.cardApproved')}
          value={totals.approved}
          sub={`${pct(totals.approved, totals.total)}%`}
          color="#2196f3"
        />
        <BigCard
          label={t('dashboard.cardQaIssues')}
          value={totalQA}
          color={totalQA > 0 ? '#e55' : '#4caf50'}
        />
        {totals.auto > 0 && (
          <BigCard label={t('home.autoTranslated')} value={totals.auto} color="#a78bfa" />
        )}
      </div>

      {/* QA issue breakdown (only when there are issues) */}
      {data.qaByType.length > 0 && (
        <div className={s.qaStrip}>
          {data.qaByType.map((r) => (
            <span
              key={r.issue_type}
              className={s.qaChip}
              style={{ '--chip-color': ISSUE_COLORS[r.issue_type] ?? '#888' } as React.CSSProperties}
            >
              {r.issue_type.replace(/_/g, ' ')} <strong>{r.count}</strong>
            </span>
          ))}
        </div>
      )}
    </section>
  );
};

/* ── 2. System status strip ──────────────────────────────────────────────── */

const SystemStrip = ({ data, t }: { data: OpsOverview; t: (k: string) => string }) => {
  const sys = data.system;
  return (
    <section className={s.sysStrip}>
      <SmCard label={t('ops.uptime')} value={fmtUptime(sys.uptimeSeconds)} />
      <SmCard label={t('ops.nodeVersion')} value={sys.nodeVersion} />
      <SmCard label={t('ops.memory')} value={`${fmtBytes(sys.heapUsedBytes)} / ${fmtBytes(sys.heapTotalBytes)}`} />
      <SmCard
        label={t('ops.dbStatus')}
        value={sys.dbConnected ? t('ops.dbOk') : t('ops.dbDown')}
        color={sys.dbConnected ? '#4caf50' : '#e55'}
      />
      {data.llm && (
        <SmCard label={t('ops.cacheEntries')} value={data.llm.cacheEntries.toLocaleString()} />
      )}
    </section>
  );
};

/* ── 3. Mod progress table ───────────────────────────────────────────────── */

const ModProgressSection = ({ data }: { data: Awaited<ReturnType<typeof api.stats.dashboard>> }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<number | null>(null);

  const totals = data.mods.reduce(
    (acc, m) => ({
      total:      acc.total + Number(m.total),
      translated: acc.translated + Number(m.translated),
      approved:   acc.approved + Number(m.approved) + Number(m.reviewed),
      draft:      acc.draft + Number(m.draft),
      tm:         acc.tm + Number(m.tm) + Number(m.fuzzy),
      auto:       acc.auto + Number(m.auto),
      qa:         acc.qa + Number(m.qa_issues),
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
          {data.mods.map((m: DashboardModRow) => {
            const p = pct(Number(m.translated), Number(m.total));
            const isOpen = expanded === m.id;
            return (
              <>
                <tr key={m.id} className={s.tr} onClick={() => setExpanded(isOpen ? null : m.id)}>
                  <td className={s.tdExpand}>
                    {isOpen ? '▾' : '▸'}
                  </td>
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
                  <td className={Number(m.qa_issues) > 0 ? s.qaHasIssues : s.qaNoIssues}>{m.qa_issues}</td>
                </tr>
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

/** GRUP breakdown sub-table rendered inside the mod row when expanded. */
const GrupSubTable = ({ modId }: { modId: number }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['grupStats', modId],
    queryFn: () => api.stats.grup(modId),
  });

  if (isLoading) return <div className={s.grupLoading}>{t('dashboard.loadingGrup')}</div>;
  if (!data || data.length === 0) return <div className={s.grupLoading}>{t('dashboard.noGrupData')}</div>;

  const maxTotal = Math.max(...data.map((r: GrupStatRow) => r.total), 1);

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
        {data.map((r: GrupStatRow) => {
          const p = pct(r.translated, r.total);
          return (
            <tr key={r.signature} className={s.grupDataRow}>
              <td className={s.grupSig}>{r.signature}</td>
              <td className={s.grupTdR}>{r.total}</td>
              <td className={s.grupTdR}>{r.translated}</td>
              <td className={s.grupTdR}>{p}%</td>
              <td className={s.grupTdProgress}>
                <Bar value={r.translated} max={maxTotal} color={p === 100 ? '#4caf50' : '#2196f3'} />
              </td>
              <td className={s.grupTdR}>{r.approved}</td>
              <td className={s.grupTdR}>{r.draft}</td>
              <td className={s.grupTdR}>{r.tm}</td>
              <td className={s.grupTdR}>{r.auto}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

/* ── 4. Recent imports ───────────────────────────────────────────────────── */

const RecentImports = ({ jobs }: { jobs: OpsImportJob[] }) => {
  const { t } = useTranslation();
  if (jobs.length === 0) return null;

  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('ops.importJobs')}</h2>
      <table className={s.table}>
        <thead>
          <tr>
            <th className={s.th}>{t('ops.jobKind')}</th>
            <th className={s.th}>{t('ops.jobFile')}</th>
            <th className={s.th}>{t('ops.jobStatus')}</th>
            <th className={s.thR}>{t('ops.jobProgress')}</th>
            <th className={s.th}>{t('ops.jobError')}</th>
            <th className={s.th}>{t('ops.jobUpdated')}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={`${j.kind}-${j.id}`} className={s.tr}>
              <td className={s.td}><span className={s.kindBadge}>{kindLabel(j.kind)}</span></td>
              <td className={s.td}>{j.file_name}</td>
              <td className={s.td}>
                <span className={jobStatusClass(j.status, s)}>
                  {t(`importStatus.${j.status}`, j.status)}
                </span>
              </td>
              <td className={s.tdR}>
                {j.imported_records}/{j.total_records}
                <span className={s.pctDim}> ({jobPct(j)}%)</span>
              </td>
              <td className={s.tdErr}>{j.last_error ?? '—'}</td>
              <td className={s.tdDim}>{new Date(j.updated_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

/* ── 5. Tech details (LLM + DB) — collapsible ────────────────────────────── */

const TechDetailsSection = ({ data }: { data: OpsOverview }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <section className={s.section}>
      <button className={s.collapseToggle} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {t('home.techDetails')}
      </button>

      {open && (
        <div className={s.techGrid}>
          {/* LLM */}
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
                  {data.llm.byModel.map((m) => (
                    <tr key={m.model} className={s.tr}>
                      <td className={s.tdMono}>{m.model}</td>
                      <td className={s.tdR}>{m.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* DB */}
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
                {data.db.tables.map((tbl: OpsTableSize) => (
                  <tr key={tbl.table_name} className={s.tr}>
                    <td className={s.tdMono}>{tbl.table_name}</td>
                    <td className={s.tdR}>{Number(tbl.row_count).toLocaleString()}</td>
                    <td className={s.tdR}>{tbl.size}</td>
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
