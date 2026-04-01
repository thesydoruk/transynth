import type { EspRecordView } from './EspRecordView.js';

/**
 * Paginated result returned by EspReader.getRecordsPage().
 */
export interface EspRecordsPage {
  /** Records for the requested page. */
  records: EspRecordView[];
  /** Total matching record count (across all pages). */
  total: number;
}
