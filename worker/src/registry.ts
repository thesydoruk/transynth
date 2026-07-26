/**
 * kind → handler map (worker process only).
 *
 * Do not import this from the API: handlers pull LLM pipelines, Wine tools and
 * importers that belong exclusively in the worker container.
 */
import { applyImportedHandler } from './handlers/applyImported';
import { batchTranslateHandler } from './handlers/batchTranslate';
import { csvImportHandler } from './handlers/csvImport';
import { eetImportHandler } from './handlers/eetImport';
import { genderDetectHandler } from './handlers/genderDetect';
import { llmTranslateHandler } from './handlers/llmTranslate';
import { llmVerifyHandler } from './handlers/llmVerify';
import { modImportHandler } from './handlers/modImport';
import { skipDetectHandler } from './handlers/skipDetect';
import { tmApplyHandler } from './handlers/tmApply';
import { voiceGenerateHandler } from './handlers/voiceGenerate';
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
};

export const getJobHandler = (kind: JobKind): JobHandler => {
  const handler = handlers[kind];
  if (!handler) throw new Error(`No handler registered for job kind "${kind}"`);
  return handler;
};
