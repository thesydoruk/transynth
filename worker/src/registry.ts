/**
 * kind → handler map (worker process only).
 *
 * Do not import this from the API: handlers pull LLM pipelines, Wine tools and
 * importers that belong exclusively in the worker container.
 */
import { applyImportedHandler } from './jobs/applyImported/handler';
import { batchTranslateHandler } from './jobs/batchTranslate';
import { csvImportHandler } from './jobs/import/csv/handler';
import { eetImportHandler } from './jobs/import/eet/handler';
import { genderDetectHandler } from './jobs/genderDetect/handler';
import { llmTranslateHandler } from './jobs/translate/handler';
import { llmVerifyHandler } from './jobs/verify/handler';
import { modImportHandler } from './jobs/import/mod/handler';
import { skipDetectHandler } from './jobs/skipDetect/handler';
import { tmApplyHandler } from './jobs/tmApply/handler';
import { voiceGenerateHandler } from './jobs/voice/handler';
import { langpackExportHandler } from './jobs/langpackExport/handler';
import type { JobHandler, JobKind } from './types';

const handlers: Record<JobKind, JobHandler> = {
  'llm-translate': llmTranslateHandler,
  'tm-apply': tmApplyHandler,
  'llm-verify': llmVerifyHandler,
  'skip-detect': skipDetectHandler,
  'gender-detect': genderDetectHandler,
  'voice-generate': voiceGenerateHandler,
  'batch-translate': batchTranslateHandler,
  'apply-imported': applyImportedHandler,
  'mod-import': modImportHandler,
  'csv-import': csvImportHandler,
  'eet-import': eetImportHandler,
  'langpack-export': langpackExportHandler,
};

export const getJobHandler = (kind: JobKind): JobHandler => {
  const handler = handlers[kind];
  if (!handler) throw new Error(`No handler registered for job kind "${kind}"`);
  return handler;
};
