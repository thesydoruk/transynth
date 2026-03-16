import { useTranslation } from 'react-i18next';
import type { OpsImportJob, OpsLlmJob } from '../../../api';
import type { AppJob } from '../../../appJobsQueue';
import type { NexusDownloadJob } from '../../../nexusDownloadQueue';
import { jobPct, jobStatusClass, kindLabel } from '../homeUtils';
import s from '../HomePage.module.scss';

interface RecentImportsProps {
  jobs: OpsImportJob[];
  nexusDownloads: NexusDownloadJob[];
  /** Real-time in-memory app jobs (LLM/export). Only running + failed shown; completed defers to llmJobs. */
  appJobs: AppJob[];
  /** Persisted LLM batch jobs from backend (survives page reload). */
  llmJobs: OpsLlmJob[];
}

type UnifiedJobRow =
  | { kind: 'import'; updatedAt: string; job: OpsImportJob }
  | { kind: 'nexus'; updatedAt: string; job: NexusDownloadJob }
  | { kind: 'app'; updatedAt: string; job: AppJob }
  | { kind: 'backend-llm'; updatedAt: string; job: OpsLlmJob };

/** Recent import jobs table shown in the overview page. */
export const RecentImports = ({ jobs, nexusDownloads, appJobs, llmJobs }: RecentImportsProps) => {
  const { t } = useTranslation();

  // In-memory app jobs: only show running/failed — completed ones are handled
  // by the persisted backend llmJobs to avoid duplicate rows after completion.
  const visibleAppJobs = appJobs.filter((j) => j.status === 'running' || j.status === 'failed');

  const rows: UnifiedJobRow[] = [
    ...jobs.map((job) => ({ kind: 'import' as const, updatedAt: job.updated_at, job })),
    ...nexusDownloads.map((job) => ({ kind: 'nexus' as const, updatedAt: new Date(job.createdAt).toISOString(), job })),
    ...visibleAppJobs.map((job) => ({ kind: 'app' as const, updatedAt: new Date(job.updatedAt).toISOString(), job })),
    ...llmJobs.map((job) => ({ kind: 'backend-llm' as const, updatedAt: job.updated_at, job })),
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  if (rows.length === 0) return null;

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
          {rows.map((row) => {
            if (row.kind === 'import') {
              const job = row.job;
              return (
                <tr key={`${job.kind}-${job.id}`} className={s.tr}>
                  <td className={s.td}><span className={s.kindBadge}>{kindLabel(job.kind)}</span></td>
                  <td className={s.td}>{job.file_name}</td>
                  <td className={s.td}><span className={jobStatusClass(job.status, s)}>{t(`importStatus.${job.status}`, job.status)}</span></td>
                  <td className={s.tdR}>{job.imported_records}/{job.total_records}<span className={s.pctDim}> ({jobPct(job)}%)</span></td>
                  <td className={s.tdErr}>{job.last_error ?? '—'}</td>
                  <td className={s.tdDim}>{new Date(job.updated_at).toLocaleString()}</td>
                </tr>
              );
            }

            if (row.kind === 'nexus') {
              const job = row.job;
              return (
                <tr key={job.id} className={s.tr}>
                  <td className={s.td}><span className={s.kindBadge}>NEXUS</span></td>
                  <td className={s.td}>{job.fileName}</td>
                  <td className={s.td}><span className={jobStatusClass(job.status, s)}>{t(`importStatus.${job.status}`, job.status)}</span></td>
                  <td className={s.tdR}>{Math.round(job.progress)}%<span className={s.pctDim}> ({t('common.loading')})</span></td>
                  <td className={s.tdErr}>{job.error ?? '—'}</td>
                  <td className={s.tdDim}>{new Date(job.createdAt).toLocaleString()}</td>
                </tr>
              );
            }

            if (row.kind === 'app') {
              const job = row.job;
              const kindLabelText = job.kind === 'llm' ? 'LLM' : 'EXPORT';
              const progressText = job.progress == null ? '—' : `${Math.round(job.progress)}%`;
              return (
                <tr key={job.id} className={s.tr}>
                  <td className={s.td}><span className={s.kindBadge}>{kindLabelText}</span></td>
                  <td className={s.td}>{job.label}</td>
                  <td className={s.td}><span className={jobStatusClass(job.status, s)}>{t(`importStatus.${job.status}`, job.status)}</span></td>
                  <td className={s.tdR}>{progressText}</td>
                  <td className={s.tdErr}>{job.error ?? '—'}</td>
                  <td className={s.tdDim}>{new Date(job.updatedAt).toLocaleString()}</td>
                </tr>
              );
            }

            if (row.kind === 'backend-llm') {
              const job = row.job;
              const label = job.mod_name ? `LLM batch · ${job.mod_name}` : `LLM batch · mod ${job.mod_id ?? '?'}`;
              const progressText = job.string_count > 0
                ? `${job.done_count}/${job.string_count} (${Math.round((job.done_count / job.string_count) * 100)}%)`
                : '—';
              return (
                <tr key={`llm-${job.id}`} className={s.tr}>
                  <td className={s.td}><span className={s.kindBadge}>LLM</span></td>
                  <td className={s.td}>{label}</td>
                  <td className={s.td}><span className={jobStatusClass(job.status, s)}>{t(`importStatus.${job.status}`, job.status)}</span></td>
                  <td className={s.tdR}>{progressText}</td>
                  <td className={s.tdErr}>{job.error ?? '—'}</td>
                  <td className={s.tdDim}>{new Date(job.updated_at).toLocaleString()}</td>
                </tr>
              );
            }

            return null;
          })}
        </tbody>
      </table>
    </section>
  );
};
