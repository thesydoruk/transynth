import type { OpsImportJob } from '../../api';

export const pct = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

export const fmtBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export const fmtUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
};

export const jobPct = (job: OpsImportJob) =>
  job.total_records > 0 ? Math.round((job.imported_records / job.total_records) * 100) : 0;

export const kindLabel = (kind: 'eet' | 'csv' | 'mod') =>
  kind === 'eet' ? 'EET' : kind === 'csv' ? 'CSV' : 'MOD';

export const jobStatusClass = (status: string, css: Record<string, string>): string => {
  switch (status) {
    case 'completed': return css.badgeOk!;
    case 'failed': return css.badgeErr!;
    case 'running': return css.badgeRun!;
    case 'in_progress':
    case 'extracting': return css.badgeRun!;
    case 'downloading': return css.badgeRun!;
    case 'paused': return css.badgeWarn!;
    default: return css.badgeDim!;
  }
};

export const ISSUE_COLORS: Record<string, string> = {
  placeholder_mismatch: '#e55',
  empty_translation: '#e55',
  forbidden_chars: '#e55',
  same_as_source: '#e8a735',
  length_delta: '#e8a735',
  glossary_violation: '#e8a735',
  duplicate_inconsistency: '#7ab',
};