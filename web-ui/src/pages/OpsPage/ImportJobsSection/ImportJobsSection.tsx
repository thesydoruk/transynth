import { useTranslation } from 'react-i18next';
import type { OpsImportJob } from '../../../api';
import { jobPct, kindLabel, statusClass } from '../opsUtils';
import parentS from '../OpsPage.module.scss';
import s from './ImportJobsSection.module.scss';

interface ImportJobsSectionProps {
  jobs: OpsImportJob[];
}

/** Recent import jobs table. */
export const ImportJobsSection = ({ jobs }: ImportJobsSectionProps) => {
  const { t } = useTranslation();

  return (
    <section className={parentS.section}>
      <h2 className={parentS.h2}>{t('ops.importJobs')}</h2>
      {jobs.length === 0 ? (
        <p className={s.empty}>{t('ops.noJobs')}</p>
      ) : (
        <table className={parentS.table}>
          <thead>
            <tr>
              <th className={parentS.th}>{t('ops.jobKind')}</th>
              <th className={parentS.th}>{t('ops.jobFile')}</th>
              <th className={parentS.th}>{t('ops.jobStatus')}</th>
              <th className={parentS.thR}>{t('ops.jobProgress')}</th>
              <th className={parentS.th}>{t('ops.jobError')}</th>
              <th className={parentS.th}>{t('ops.jobUpdated')}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={`${job.kind}-${job.id}`} className={parentS.tr}>
                <td className={s.td}><span className={s.kindBadge}>{kindLabel(job.kind)}</span></td>
                <td className={s.td}>{job.file_name}</td>
                <td className={s.td}><span className={statusClass(job.status)}>{t(`importStatus.${job.status}`, job.status)}</span></td>
                <td className={parentS.tdR}>{job.imported_records}/{job.total_records}<span className={s.pctDim}> ({jobPct(job)}%)</span></td>
                <td className={s.tdErr}>{job.last_error ?? '—'}</td>
                <td className={s.tdDim}>{new Date(job.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
