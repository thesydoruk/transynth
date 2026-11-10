/**
 * The units of a run's plan: finding one from an upload URL, recording what the
 * upload did to it, and telling which planned uploads never arrived.
 */
import type { Tx } from '../db';
import { vortexUnitKey } from './groupKey';
import type { VortexPlanUnit } from './types';

type PlanUnitRow = Record<string, unknown> & { unitId?: unknown };

/** The unit an upload URL names: by its short key, or by its full id from an older agent. */
export const findPlanUnit = <T extends PlanUnitRow>(units: T[], param: string): T | undefined =>
  units.find(
    (row) =>
      typeof row.unitId === 'string' &&
      (row.unitId === param || vortexUnitKey(row.unitId) === param),
  );

/**
 * Merge `patch` into one unit of the run's plan in a single statement, so two
 * uploads to the same run cannot overwrite each other's result.
 */
export const patchVortexPlanUnit = async (
  db: Tx,
  runId: number,
  unitId: string,
  patch: Record<string, unknown>,
): Promise<void> => {
  await db.query(
    `UPDATE vortex_sync_runs
        SET plan_json = jsonb_set(plan_json, '{units}', (
              SELECT COALESCE(jsonb_agg(
                       CASE WHEN u->>'unitId' = $2 THEN u || $3::jsonb ELSE u END
                       ORDER BY ord), '[]'::jsonb)
                FROM jsonb_array_elements(plan_json->'units') WITH ORDINALITY AS t(u, ord))),
            updated_at = NOW()
      WHERE id = $1 AND jsonb_typeof(plan_json->'units') = 'array'`,
    [runId, unitId, JSON.stringify(patch)],
  );
};

/** The jobs an upload registered: one per plugin of the folder, or the one job. */
export const unitJobIds = (unit: VortexPlanUnit): number[] => {
  const fromJobs = (unit.jobs ?? []).map((row) => row.jobId).filter((id) => id > 0);
  if (fromJobs.length > 0) return [...new Set(fromJobs)];
  return unit.existingJobId ? [unit.existingJobId] : [];
};

/**
 * Units the plan asked the agent to upload that the server never registered
 * and never refused: their upload did not reach the route, so importing the
 * rest and calling the run complete would drop them without a word.
 */
export const unitsNeverUploaded = (units: VortexPlanUnit[]): VortexPlanUnit[] =>
  units.filter(
    (unit) =>
      (unit.action === 'upload' || unit.action === 'update') &&
      !unit.existingJobId &&
      !unit.rejected,
  );
