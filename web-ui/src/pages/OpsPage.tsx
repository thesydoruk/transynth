/**
 * OpsPage — Health & Operations dashboard.
 *
 * Displays four sections:
 * 1. **System** — uptime, Node version, memory usage, DB connectivity.
 * 2. **Import Jobs** — recent EET / CSV / Mod imports with progress and errors.
 * 3. **LLM** — translation cache size, auto-translated counts, per-model breakdown.
 * 4. **Database** — total DB size and per-table row counts / disk sizes.
 *
 * Data is fetched from a single `GET /api/ops` endpoint and auto-refreshes
 * every 30 seconds so the page acts as a live monitoring panel.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { OpsOverview, OpsImportJob, OpsTableSize } from '../api';
import s from './OpsPage.module.scss';

/** Auto-refresh interval for the ops overview (30 seconds). */
const REFETCH_INTERVAL = 30_000;

/** Format bytes into a short human-readable string (KB / MB / GB). */
const fmtBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/** Format seconds into "Xd Yh Zm" or "Xh Ym Zs". */
const fmtUptime = (sec: number): string => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const sRem = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sRem}s`;
  return `${m}m ${sRem}s`;
};

/** CSS class for import job status badges. */
const statusClass = (status: string): string => {
  switch (status) {
    case 'completed': return s.badgeOk;
    case 'failed': return s.badgeErr;
    case 'in_progress':
    case 'extracting': return s.badgeRun;
    case 'paused': return s.badgeWarn;
    default: return s.badgeDim;
  }
};

/** Tag label for the job kind (EET / CSV / MOD). */
const kindLabel = (kind: 'eet' | 'csv' | 'mod') =>
  kind === 'eet' ? 'EET' : kind === 'csv' ? 'CSV' : 'MOD';

/**
 * Progress percentage for an import job.
 * Returns 0 when total is 0 to avoid division-by-zero.
 */
const jobPct = (j: OpsImportJob) =>
  j.total_records > 0 ? Math.round((j.imported_records / j.total_records) * 100) : 0;

/* ═══════════════════════════════════════════════════════════════════════════ */

export const OpsPage = () => {
  const { t } = useTranslation();

  const { data, isLoading, error } = useQuery({
    queryKey: ['ops'],
    queryFn: api.ops.overview,
    refetchInterval: REFETCH_INTERVAL,
  });

  if (isLoading) return <div className={s.center}>{t('ops.loading')}</div>;
  if (error) return <div className={`${s.center} ${s.error}`}>{t('common.error', { message: String(error) })}</div>;
  if (!data) return null;

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('ops.title')}</h1>

      {/* ── System ────────────────────────────────────────────────────── */}
      <SystemSection data={data} />

      {/* ── Import Jobs ───────────────────────────────────────────────── */}
      <ImportJobsSection jobs={data.importJobs} />

      {/* ── LLM / Auto-translate ──────────────────────────────────────── */}
      <LlmSection data={data} />

      {/* ── Database ──────────────────────────────────────────────────── */}
      <DbSection data={data} />
    </div>
  );
};

/* ── Sub-sections ─────────────────────────────────────────────────────────── */

/** System health cards: uptime, Node version, memory, DB status. */
const SystemSection = ({ data }: { data: OpsOverview }) => {
  const { t } = useTranslation();
  const sys = data.system;
  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('ops.system')}</h2>
      <div className={s.cards}>
        <MiniCard label={t('ops.uptime')} value={fmtUptime(sys.uptimeSeconds)} />
        <MiniCard label={t('ops.nodeVersion')} value={sys.nodeVersion} />
        <MiniCard
          label={t('ops.memory')}
          value={fmtBytes(sys.heapUsedBytes)}
          sub={`/ ${fmtBytes(sys.heapTotalBytes)}`}
        />
        <MiniCard
          label={t('ops.rss')}
          value={fmtBytes(sys.memoryRssBytes)}
        />
        <MiniCard
          label={t('ops.dbStatus')}
          value={sys.dbConnected ? t('ops.dbOk') : t('ops.dbDown')}
          color={sys.dbConnected ? '#4caf50' : '#e55'}
        />
      </div>
    </section>
  );
};

/** Recent import jobs table. */
const ImportJobsSection = ({ jobs }: { jobs: OpsImportJob[] }) => {
  const { t } = useTranslation();
  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('ops.importJobs')}</h2>
      {jobs.length === 0 ? (
        <p className={s.empty}>{t('ops.noJobs')}</p>
      ) : (
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
                <td className={s.td}>
                  <span className={s.kindBadge}>{kindLabel(j.kind)}</span>
                </td>
                <td className={s.td}>{j.file_name}</td>
                <td className={s.td}>
                  <span className={statusClass(j.status)}>{t(`importStatus.${j.status}`, j.status)}</span>
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
      )}
    </section>
  );
};

/** LLM / auto-translate stats: cache size, total auto-translated, per-model. */
const LlmSection = ({ data }: { data: OpsOverview }) => {
  const { t } = useTranslation();
  const llm = data.llm;
  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('ops.llm')}</h2>
      <div className={s.cards}>
        <MiniCard label={t('ops.cacheEntries')} value={llm.cacheEntries.toLocaleString()} />
        <MiniCard label={t('ops.autoTranslated')} value={llm.autoTranslated.toLocaleString()} />
      </div>
      {llm.byModel.length > 0 && (
        <table className={s.compactTable}>
          <thead>
            <tr>
              <th className={s.th}>{t('ops.model')}</th>
              <th className={s.thR}>{t('ops.count')}</th>
            </tr>
          </thead>
          <tbody>
            {llm.byModel.map((m) => (
              <tr key={m.model} className={s.tr}>
                <td className={s.tdMono}>{m.model}</td>
                <td className={s.tdR}>{m.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

/** Database size metrics: total size + per-table breakdown. */
const DbSection = ({ data }: { data: OpsOverview }) => {
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
          {db.tables.map((t: OpsTableSize) => (
            <tr key={t.table_name} className={s.tr}>
              <td className={s.tdMono}>{t.table_name}</td>
              <td className={s.tdR}>{Number(t.row_count).toLocaleString()}</td>
              <td className={s.tdR}>{t.size}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

/* ── Reusable mini-card ───────────────────────────────────────────────────── */

/** Small key-value card used in the summary rows. */
const MiniCard = ({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) => (
  <div className={s.card} style={color ? { '--card-color': color } as React.CSSProperties : undefined}>
    <div className={s.cardValue}>{value}</div>
    <div className={s.cardLabel}>
      {label}
      {sub && <span className={s.cardSub}>{sub}</span>}
    </div>
  </div>
);
