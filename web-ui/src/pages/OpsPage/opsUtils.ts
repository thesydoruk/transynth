import type { OpsImportJob } from '../../api';
import s from './OpsPage.module.scss';

/** Format bytes into a short human-readable string (KB / MB / GB). */
export const fmtBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/** Format seconds into Xd Yh Zm or Xh Ym Zs form. */
export const fmtUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
};

/** CSS class for import job status badges. */
export const statusClass = (status: string): string => {
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
export const kindLabel = (kind: 'eet' | 'csv' | 'mod') =>
  kind === 'eet' ? 'EET' : kind === 'csv' ? 'CSV' : 'MOD';

/** Progress percentage for an import job. */
export const jobPct = (job: OpsImportJob) =>
  job.total_records > 0 ? Math.round((job.imported_records / job.total_records) * 100) : 0;