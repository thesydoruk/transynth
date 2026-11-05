/**
 * Ordered Vortex sync stages. The order is fixed; callers cut a contiguous range.
 *
 * Two kinds of server stage:
 * - in-process — `import`, `carry`, `export` run inside one `vortex-sync` job;
 * - fan-out — `tm`, `llm`, `verify`, `skip`, `gender`, `voice` are the same per-mod
 *   jobs the editor starts, enqueued one mod at a time by a `vortex-sync` job
 *   that only orchestrates. They keep their own queue (LLM and TTS run one job
 *   at a time), their 409 guards, and their stop buttons.
 */
import type { ServiceKind } from '../services/kinds';

const VORTEX_STAGES = [
  'plan',
  'upload',
  'import',
  'carry',
  'tm',
  'llm',
  'verify',
  'skip',
  'gender',
  'voice',
  'export',
] as const;

export type VortexStage = (typeof VORTEX_STAGES)[number];

export const VORTEX_CHANNELS = ['all', 'mods', 'game'] as const;
export type VortexChannel = (typeof VORTEX_CHANNELS)[number];

export const SERVER_VORTEX_STAGES = [
  'import',
  'carry',
  'tm',
  'llm',
  'verify',
  'skip',
  'gender',
  'voice',
  'export',
] as const;
export type ServerVortexStage = (typeof SERVER_VORTEX_STAGES)[number];

export const FAN_OUT_STAGES = ['tm', 'llm', 'verify', 'skip', 'gender', 'voice'] as const;
export type VortexFanOutStage = (typeof FAN_OUT_STAGES)[number];

/** The per-mod job kind a fan-out stage enqueues. */
export const STAGE_JOB_KIND = {
  tm: 'tm-apply',
  llm: 'llm-translate',
  verify: 'llm-verify',
  skip: 'skip-detect',
  gender: 'gender-detect',
  voice: 'voice-generate',
} as const satisfies Record<VortexFanOutStage, string>;

/** Service kinds a stage needs a healthy host for before it is worth starting. */
export const STAGE_NEEDS: Record<ServerVortexStage, readonly ServiceKind[]> = {
  import: [],
  carry: [],
  tm: [],
  llm: ['llm', 'embed'],
  verify: ['llm', 'embed'],
  skip: ['llm'],
  gender: ['llm'],
  voice: ['tts'],
  export: [],
};

const STAGE_INDEX = new Map(VORTEX_STAGES.map((stage, index) => [stage, index]));

export const isVortexStage = (value: string): value is VortexStage =>
  STAGE_INDEX.has(value as VortexStage);

export const isServerVortexStage = (value: string): value is ServerVortexStage =>
  (SERVER_VORTEX_STAGES as readonly string[]).includes(value);

export const isFanOutStage = (value: string): value is VortexFanOutStage =>
  (FAN_OUT_STAGES as readonly string[]).includes(value);

export const isVortexChannel = (value: string): value is VortexChannel =>
  (VORTEX_CHANNELS as readonly string[]).includes(value);

const stageIndex = (stage: VortexStage): number => STAGE_INDEX.get(stage) ?? -1;

export const resolveStageRange = (from?: string, to?: string, single?: string): VortexStage[] => {
  if (single) {
    if (!isVortexStage(single)) throw new Error(`Unknown stage: ${single}`);
    return [single];
  }
  const start = from ?? 'plan';
  const end = to ?? 'export';
  if (!isVortexStage(start)) throw new Error(`Unknown --from stage: ${start}`);
  if (!isVortexStage(end)) throw new Error(`Unknown --to stage: ${end}`);
  const startIdx = stageIndex(start);
  const endIdx = stageIndex(end);
  if (startIdx > endIdx) {
    throw new Error(`Stage range is empty: ${start} is after ${end}`);
  }
  return VORTEX_STAGES.slice(startIdx, endIdx + 1);
};

export const serverStagesIn = (stages: readonly VortexStage[]): ServerVortexStage[] =>
  stages.filter((stage): stage is ServerVortexStage => isServerVortexStage(stage));

/** plan/upload/import need a hashed staging inventory. The rest do not. */
export const needsVortexFileInventory = (stages: readonly VortexStage[]): boolean =>
  stages.some((stage) => stage === 'plan' || stage === 'upload' || stage === 'import');

/** Stages one `vortex-sync` job runs in-process; fan-out stages go one by one. */
export const vortexWorkerStages = (stages: readonly VortexStage[]): ServerVortexStage[] =>
  serverStagesIn(stages).filter((stage) => !isFanOutStage(stage));

export const vortexFanOutStagesIn = (stages: readonly VortexStage[]): VortexFanOutStage[] =>
  stages.filter((stage): stage is VortexFanOutStage => isFanOutStage(stage));

/**
 * The CLI runs a range as: in-process stages before TM (import, carry), then
 * every fan-out stage in order, then export. Kept for the manual CLI.
 */
export const splitVortexPipeline = (
  stages: readonly VortexStage[],
): {
  beforeTm: ServerVortexStage[];
  fanOut: VortexFanOutStage[];
  wantsExport: boolean;
} => ({
  beforeTm: vortexWorkerStages(stages).filter((stage) => stage !== 'export'),
  fanOut: vortexFanOutStagesIn(stages),
  wantsExport: stages.includes('export'),
});

/**
 * One `vortex-sync` job may not straddle a fan-out stage: `import→carry` and
 * `export` are the only in-process ranges, and fan-out stages sit between them.
 */
export const vortexRangeCrossesFanOut = (stages: readonly VortexStage[]): boolean => {
  const inProcess = vortexWorkerStages(stages);
  return inProcess.includes('export') && inProcess.some((stage) => stage !== 'export');
};
