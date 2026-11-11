/**
 * A fan-out stage of a Vortex run: the same per-mod job the editor would start,
 * enqueued for one mod at a time and followed to its end, so LLM and TTS still
 * see one job each, the editor shows its usual badges, and every mod keeps its
 * own stop button. The run row records each mod's job in `plan_json.modJobs`.
 */
import type { Tx } from '../../../../src/db';
import { log } from '../../../../src/logger';
import { updateVortexSyncRun, type VortexSyncRunRow } from '../../../../src/vortex/db';
import { STAGE_JOB_KIND, type VortexFanOutStage } from '../../../../src/vortex/stages';
import type { JobData, JobKind, JobSnapshot } from '../../types';
import { isVoiceNoWorkError } from '../voice/noWork';

export type VortexModJob = {
  modId: number;
  name: string;
  kind: JobKind;
  jobId: number | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  done: number;
  total: number;
  error: string | null;
};

export type FanOutStageOptions = Record<string, unknown>;

export type FanOutDeps = {
  enqueue: (data: JobData, initial: Record<string, unknown>) => Promise<number>;
  readSnapshot: (jobId: number) => Promise<JobSnapshot | null>;
  /** True when another job of these kinds already runs for the mod (409 guard). */
  isBusy: (kinds: readonly JobKind[], modId: number) => Promise<boolean>;
  stop: (jobId: number) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
};

type ModRef = { id: number; name: string; game: string };

const VERIFY_FLAGS = ['autoApproveVerified', 'fixSuspicious', 'includeConfirmed', 'dryRun'];

const bool = (options: FanOutStageOptions, key: string, fallback: boolean): boolean =>
  typeof options[key] === 'boolean' ? (options[key] as boolean) : fallback;

/** The job payload and initial snapshot the per-mod routes would have built. */
export const jobDataForStage = (
  stage: VortexFanOutStage,
  mod: ModRef,
  run: Pick<VortexSyncRunRow, 'src_lang' | 'tgt_lang'>,
  options: FanOutStageOptions = {},
): { data: JobData; initial: Record<string, unknown> } => {
  const kind = STAGE_JOB_KIND[stage];
  const base = {
    srcLang: run.src_lang,
    targetLang: run.tgt_lang,
    modName: mod.name,
    game: mod.game,
  };
  switch (stage) {
    case 'tm':
      return {
        data: { kind, modId: mod.id, params: { srcLang: run.src_lang, targetLang: run.tgt_lang } },
        initial: { applied: 0, skipped: 0 },
      };
    case 'llm':
      return { data: { kind, modId: mod.id, params: base }, initial: { rows: [] } };
    case 'verify':
      return {
        data: {
          kind,
          modId: mod.id,
          params: {
            ...base,
            ...Object.fromEntries(VERIFY_FLAGS.map((flag) => [flag, bool(options, flag, false)])),
          },
        },
        initial: { approved: 0, fixed: 0, issues: [], actionLog: [] },
      };
    case 'skip':
      return {
        data: {
          kind,
          modId: mod.id,
          params: {
            srcLang: run.src_lang,
            modName: mod.name,
            game: mod.game,
            useLlm: bool(options, 'useLlm', false),
            force: bool(options, 'force', false),
            persist: bool(options, 'persist', true),
          },
        },
        initial: { candidates: [], markedCount: 0 },
      };
    case 'gender':
      return {
        data: {
          kind,
          modId: mod.id,
          params: {
            srcLang: run.src_lang,
            modName: mod.name,
            game: mod.game,
            useLlm: bool(options, 'useLlm', true),
            force: bool(options, 'force', false),
          },
        },
        initial: { resolvedCount: 0 },
      };
    case 'voice':
      return {
        data: {
          kind,
          modId: mod.id,
          params: {
            ...base,
            scope: options.scope === 'low-similarity' ? 'low-similarity' : 'missing',
          },
        },
        initial: { written: 0, skipped: 0, warningCount: 0 },
      };
  }
};

/** Kinds that must not already run for a mod before this stage's job starts. */
const guardKinds = (kind: JobKind): readonly JobKind[] =>
  kind === 'tm-apply' || kind === 'llm-translate' ? ['tm-apply', 'llm-translate'] : [kind];

const isTerminal = (status: JobSnapshot['status']): boolean => status !== 'running';

export const runFanOutStage = async (
  db: Tx,
  run: VortexSyncRunRow,
  stage: VortexFanOutStage,
  mods: ModRef[],
  options: FanOutStageOptions,
  opts: { isCancelled: () => boolean },
  deps: FanOutDeps,
): Promise<VortexModJob[]> => {
  const kind = STAGE_JOB_KIND[stage];
  const modJobs: VortexModJob[] = mods.map((mod) => ({
    modId: mod.id,
    name: mod.name,
    kind,
    jobId: null,
    status: 'queued',
    done: 0,
    total: 0,
    error: null,
  }));
  const plan = (run.plan_json && typeof run.plan_json === 'object' ? run.plan_json : {}) as Record<
    string,
    unknown
  >;
  const save = async (modId?: number) =>
    updateVortexSyncRun(db, run.id, {
      plan_json: { ...plan, modJobs },
      ...(modId != null ? { current_mod_id: modId } : {}),
    });
  await save();

  for (const [index, mod] of mods.entries()) {
    const entry = modJobs[index]!;
    if (opts.isCancelled()) {
      entry.status = 'cancelled';
      continue;
    }
    if (await deps.isBusy(guardKinds(kind), mod.id)) {
      entry.status = 'skipped';
      entry.error = 'a job of this kind is already running for the mod';
      await save(mod.id);
      continue;
    }
    const { data, initial } = jobDataForStage(stage, mod, run, options);
    entry.jobId = await deps.enqueue(data, initial);
    entry.status = 'running';
    await save(mod.id);
    log.info(`Vortex ${stage}: mod #${mod.id} ${mod.name} → ${kind} job #${entry.jobId}`);

    for (;;) {
      await deps.sleep(deps.pollMs);
      if (opts.isCancelled()) {
        await deps.stop(entry.jobId);
        entry.status = 'cancelled';
        break;
      }
      const snapshot = await deps.readSnapshot(entry.jobId);
      if (!snapshot) {
        entry.status = 'failed';
        entry.error = 'job snapshot vanished';
        break;
      }
      entry.done = snapshot.done;
      entry.total = snapshot.total;
      if (isTerminal(snapshot.status)) {
        entry.status =
          snapshot.status === 'failed' &&
          kind === 'voice-generate' &&
          isVoiceNoWorkError(snapshot.error)
            ? 'skipped'
            : snapshot.status;
        entry.error = snapshot.error;
        break;
      }
      await save(mod.id);
    }
    await save(mod.id);
  }
  return modJobs;
};
