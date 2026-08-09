import os from 'node:os';
import { Semaphore } from '../../../utils/concurrency';

/** Parallelism for UK voice import: half the CPUs, but at least 4. */
export const ukVoiceImportConcurrency = (): number =>
  Math.max(4, Math.floor((os.cpus().length || 1) / 2));

/** Shared cap so nested speaker + clip pools do not oversubscribe ffmpeg/CPU. */
export const createUkVoiceImportSemaphore = (): Semaphore =>
  new Semaphore(ukVoiceImportConcurrency());
