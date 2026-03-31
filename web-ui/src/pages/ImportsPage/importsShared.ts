import type { CsvImportJob, EetImportJob, ModImportJob } from '../../api';
import { getContentLanguageOptions } from '../../langDefaults';

/** Live SSE progress for a running import. */
export type LiveProgress = { imported: number; total: number };

export type ModPreviewConfirmPayload = {
  importLang: string;
  applyEnabled: boolean;
  applyToModId: number | null;
  importAllLocalizations?: boolean;
};

/** Language options shared by all import preview modals. */
export const LANGUAGES = getContentLanguageOptions();

/** Background color for a job status badge. */
export const statusColorBase = (status: string): string => {
  switch (status) {
    case 'pending': return '#555';
    case 'extracting': return '#6a1b9a';
    case 'in_progress': return '#1565c0';
    case 'paused': return '#e65100';
    case 'failed': return '#b71c1c';
    case 'completed': return '#1b6b2d';
    default: return '#555';
  }
};

/** Color for the type badge in the unified list. */
export const kindColor = (kind: 'eet' | 'csv' | 'mod'): string => {
  switch (kind) {
    case 'eet': return '#6a1b9a';
    case 'csv': return '#1565c0';
    case 'mod': return '#e65100';
  }
};

/** Translated status label for a job. */
export const statusLabel = (status: string, t: (key: string) => string): string => t(`importStatus.${status}`) || status;

export interface UnifiedJobRowProps {
  kind: 'eet' | 'csv' | 'mod';
  job: EetImportJob | CsvImportJob | ModImportJob;
  live?: LiveProgress;
  isRunning: boolean;
  exportActions?: Array<{
    key: 'strings' | 'esp' | 'ba2' | 'zip';
    icon: string;
    title: string;
    disabled?: boolean;
    onClick: () => void;
  }>;
  onStart: () => void;
  onPause: () => void;
  onCancel: () => void;
  onDelete: () => void;
}
