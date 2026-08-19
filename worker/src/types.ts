/**
 * Shared contracts for the worker package (`worker/`).
 *
 * Layout:
 *   types.ts / main.ts / processor / registry / runTrackedJob
 *   core/     — Redis, BullMQ queue, snapshots, control channel
 *   api/      — SSE enqueue/relay, status, stop (used by web routes)
 *   jobs/     — feature folders: handler + runJob (+ pipeline when needed)
 *     translate/  verify/  skipDetect/  genderDetect/
 *     tmApply/  voice/  applyImported/  import/
 *     shared/   — splitLongText, glossary helpers
 *     batchTranslate.ts
 *
 * The API enqueues BullMQ jobs; the worker runs the handler for `kind`.
 * Progress travels as `JobEvent`s via `updateProgress`, which `api/` replays
 * to browsers over SSE — the frontend keeps its existing event shapes.
 *
 * `jobs/import/{mod,csv,eet}` own the ingestion loops themselves. What stays in
 * `src/import` is the part the API also needs: file discovery, registration and
 * the `*_imports` job rows.
 */
import type { Tx } from '../../src/db';

export const JOB_KINDS = [
  'llm-translate',
  'tm-apply',
  'llm-verify',
  'skip-detect',
  'gender-detect',
  'voice-generate',
  'batch-translate',
  'apply-imported',
  'mod-import',
  'csv-import',
  'eet-import',
  'langpack-export',
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

/** Payload stored in the BullMQ job. */
export type JobData = {
  kind: JobKind;
  /** Mod the job belongs to; null for project-wide work. */
  modId: number | null;
  /** Handler input (language pair, flags, file paths, …). */
  params: Record<string, unknown>;
};

/**
 * Progress payload forwarded verbatim to the browser.
 *
 * Handlers reuse the event shapes their services already emitted over SSE
 * (`started`, `progress`, `done`, `cancelled`, `error`, …). Events that carry
 * a `jobId` must carry the BullMQ job id — stop endpoints resolve it.
 */
export type JobEvent = { type: string } & Record<string, unknown>;

export type JobSnapshotStatus = 'running' | 'completed' | 'cancelled' | 'failed';

/**
 * Latest state of a job, kept in Redis with a TTL.
 *
 * Backs status GET routes (reopened modals, the active-jobs poll).
 * `data` holds handler-specific accumulation: translated rows, verify issues, …
 */
export type JobSnapshot = {
  jobId: number;
  kind: JobKind;
  modId: number | null;
  status: JobSnapshotStatus;
  done: number;
  total: number;
  error: string | null;
  data: Record<string, unknown>;
};

/** What a handler gets from the worker runtime. */
export type JobContext = {
  jobId: number;
  data: JobData;
  /** Aborted on Stop and on worker shutdown. */
  signal: AbortSignal;
  isCancelled: () => boolean;
  /** Publish a progress event to SSE subscribers; also feeds the snapshot counters. */
  emit: (event: JobEvent) => void;
  /** Merge handler-specific state into the snapshot for late status reads. */
  mergeSnapshot: (data: Record<string, unknown>) => void;
  /** Register a pause reaction (mod/CSV/EET imports); ignored by other kinds. */
  onPause: (handler: () => void) => void;
};

/**
 * Handler outcome. Cancelled and internally-failed jobs finish "successfully"
 * from BullMQ's point of view (no retry); the snapshot records the truth.
 * Throwing marks the BullMQ job failed — reserve it for setup errors.
 */
export type JobResult = {
  status: Extract<JobSnapshotStatus, 'completed' | 'cancelled' | 'failed'>;
  error?: string | null;
  done?: number;
  total?: number;
};

export type JobHandler = (db: Tx, ctx: JobContext) => Promise<JobResult>;
