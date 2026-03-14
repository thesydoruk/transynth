import { useTranslation } from 'react-i18next';
import type { OpsImportJob } from '../../../api';
import type { AppJob } from '../../../appJobsQueue';
import type { NexusDownloadJob } from '../../../nexusDownloadQueue';
import { jobPct, jobStatusClass, kindLabel } from '../homeUtils';
import s from '../HomePage.module.scss';

interface RecentImportsProps {
  jobs: OpsImportJob[];
  nexusDownloads: NexusDownloadJob[];
  appJobs: AppJob[];
}

type UnifiedJobRow =
  | { kind: 'import'; updatedAt: string; job: OpsImportJob }
  | { kind: 'nexus'; updatedAt: string; job: NexusDownloadJob }
  | { kind: 'app'; updatedAt: string; job: AppJob };

/** Recent import jobs table shown in the overview page. */
export const RecentImports = ({ jobs, nexusDownloads, appJobs }: RecentImportsProps) => {
  const { t } = useTranslation();
  const rows: UnifiedJobRow[] = [
    ...jobs.map((job) => ({ kind: 'import' as const, updatedAt: job.updated_at, job })),
    ...nexusDownloads.map((job) => ({ kind: 'nexus' as const, updatedAt: new Date(job.createdAt).toISOString(), job })),
    ...appJobs.map((job) => ({ kind: 'app' as const, updatedAt: new Date(job.updatedAt).toISOString(), job })),
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

            return null;
          })}
        </tbody>
      </table>
    </section>
  );
};
