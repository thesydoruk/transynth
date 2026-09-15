/** Ordered Vortex sync stages. Order is fixed; callers may cut a contiguous range. */
const VORTEX_STAGES = [
  'plan',
  'upload',
  'import',
  'carry',
  'tm',
  'llm',
  'export',
  'install',
] as const;

export type VortexStage = (typeof VORTEX_STAGES)[number];

export const VORTEX_CHANNELS = ['all', 'mods', 'game'] as const;
export type VortexChannel = (typeof VORTEX_CHANNELS)[number];

export const SERVER_VORTEX_STAGES = ['import', 'carry', 'tm', 'llm', 'export'] as const;
export type ServerVortexStage = (typeof SERVER_VORTEX_STAGES)[number];

const STAGE_INDEX = new Map(VORTEX_STAGES.map((stage, index) => [stage, index]));

const isVortexStage = (value: string): value is VortexStage =>
  STAGE_INDEX.has(value as VortexStage);

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
  stages.filter((stage): stage is ServerVortexStage =>
    (SERVER_VORTEX_STAGES as readonly string[]).includes(stage),
  );

/** plan/upload/import need a hashed staging inventory. TM/LLM do not. */
export const needsVortexFileInventory = (stages: readonly VortexStage[]): boolean =>
  stages.some((stage) => stage === 'plan' || stage === 'upload' || stage === 'import');

/**
 * Stages that still run inside the vortex-sync worker.
 * `tm` is the same `tm-apply` job as the editor, started by the CLI/API.
 */
export const vortexWorkerStages = (stages: readonly VortexStage[]): ServerVortexStage[] =>
  serverStagesIn(stages).filter((stage) => stage !== 'tm');

/** TM is a real `tm-apply` job; vortex-sync only runs the stages on each side. */
export const splitVortexPipeline = (
  stages: readonly VortexStage[],
): {
  beforeTm: ServerVortexStage[];
  wantsTm: boolean;
  afterTm: ServerVortexStage[];
} => {
  const tmAt = stages.indexOf('tm');
  if (tmAt < 0) {
    return { beforeTm: vortexWorkerStages(stages), wantsTm: false, afterTm: [] };
  }
  return {
    beforeTm: vortexWorkerStages(stages.slice(0, tmAt)),
    wantsTm: true,
    afterTm: vortexWorkerStages(stages.slice(tmAt + 1)),
  };
};

/** A single vortex-sync job cannot straddle TM (LLM would run before TM apply). */
export const vortexRangeCrossesTm = (stages: readonly VortexStage[]): boolean => {
  const { beforeTm, wantsTm, afterTm } = splitVortexPipeline(stages);
  return wantsTm && beforeTm.length > 0 && afterTm.length > 0;
};
