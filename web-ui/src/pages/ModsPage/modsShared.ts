import type { ModImportJob } from '../../api';

/** Live SSE progress for a running import. */
export type LiveProgress = { imported: number; total: number };

export type ModExportAction = {
  key: 'langpack' | 'fullMod';
  icon: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
};

/** Minimal import job fields shared by mod import list rows. */
export type ImportJobLike = {
  status: string;
  imported_records: number;
  running?: boolean;
};

/** DB says in_progress but no worker/SSE is active (e.g. after server restart). */
const isStaleImportInProgress = (job: ImportJobLike, isRunning: boolean): boolean =>
  job.status === 'in_progress' && !isRunning;

/** Resume paused or interrupted import — continue from saved progress. */
export const isImportJobResume = (job: ImportJobLike, isRunning: boolean): boolean =>
  job.status === 'paused' || isStaleImportInProgress(job, isRunning);

/** i18n key under importStatus.* for badge label. */
export const importStatusI18nKey = (job: ImportJobLike, isRunning: boolean): string =>
  isStaleImportInProgress(job, isRunning) ? 'interrupted' : job.status;

/** Map backend/app job status to importStatus.* i18n key. */
export const importStatusKey = (status: string): string =>
  status === 'running' ? 'running' : status;

/** Whether the user can start, resume, or retry this import from the UI. */
export const canStartImportJob = (job: ImportJobLike, isRunning: boolean): boolean => {
  if (isRunning || job.status === 'extracting') return false;
  return ['pending', 'paused', 'failed', 'in_progress', 'completed'].includes(job.status);
};

export const importStartTooltip = (
  job: ImportJobLike,
  isRunning: boolean,
  t: (key: string) => string,
): string => {
  if (job.status === 'failed') return t('imports.retryLabel');
  if (job.status === 'completed') return t('imports.reimportTooltip');
  if (job.status === 'paused' || isStaleImportInProgress(job, isRunning)) {
    return t('imports.resumeLabel');
  }
  return t('imports.startTooltip');
};

export const importStartButtonLabel = (
  job: ImportJobLike,
  isRunning: boolean,
  t: (key: string) => string,
): string => {
  if (job.status === 'failed') return t('imports.retryLabel');
  if (job.status === 'paused' || isStaleImportInProgress(job, isRunning)) {
    return t('imports.resumeLabel');
  }
  return t('imports.startLabel');
};

/** Background color for a job status badge. */
export const statusColorBase = (status: string): string => {
  switch (status) {
    case 'pending':
      return '#555';
    case 'extracting':
      return '#6a1b9a';
    case 'in_progress':
      return '#1565c0';
    case 'paused':
    case 'interrupted':
      return '#e65100';
    case 'failed':
      return '#b71c1c';
    case 'completed':
      return '#1b6b2d';
    default:
      return '#555';
  }
};

/** Color for the mod type badge in the import list. */
export const MOD_BADGE_COLOR = '#e65100';

/** Translated status label for a job. */
export const statusLabel = (
  status: string,
  t: (key: string) => string,
  job?: ImportJobLike,
  isRunning?: boolean,
): string => {
  const key = job != null && isRunning != null ? importStatusI18nKey(job, isRunning) : status;
  return t(`importStatus.${key}`) || status;
};

export interface UnifiedJobRowProps {
  job: ModImportJob;
  live?: LiveProgress;
  isRunning: boolean;
  exportActions?: ModExportAction[];
  modDataMenu?: {
    clearingRows?: boolean;
    deletingAll?: boolean;
    onClearRows: () => void;
    onDeleteAll: () => void;
  };
  onStart: () => void;
  onPause: () => void;
  onCancel: () => void;
  onDelete: () => void;
}
