/**
 * OpsPage — Health & Operations dashboard.
 *
 * Displays four sections:
 * 1. **System** — uptime, Node version, memory usage, DB connectivity.
 * 2. **Import Jobs** — recent EET / CSV / Mod imports with progress and errors.
 * 3. **LLM** — auto-translated counts, per-model breakdown.
 * 4. **Database** — total DB size and per-table row counts / disk sizes.
 *
 * Data is fetched from a single `GET /api/ops` endpoint and auto-refreshes
 * every 30 seconds so the page acts as a live monitoring panel.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { DbSection } from './DbSection';
import { ImportJobsSection } from './ImportJobsSection';
import { LlmSection } from './LlmSection';
import { SystemSection } from './SystemSection';
import s from './OpsPage.module.scss';

/** Auto-refresh interval for the ops overview (30 seconds). */
const REFETCH_INTERVAL = 30_000;

/* ═══════════════════════════════════════════════════════════════════════════ */

export const OpsPage = () => {
  const { t } = useTranslation();

  const { data, isLoading, error } = useQuery({
    queryKey: ['ops'],
    queryFn: api.ops.overview,
    refetchInterval: REFETCH_INTERVAL,
  });

  if (isLoading) return <div className={s.center}>{t('ops.loading')}</div>;
  if (error)
    return (
      <div className={`${s.center} ${s.error}`}>
        {t('common.error', { message: String(error) })}
      </div>
    );
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
