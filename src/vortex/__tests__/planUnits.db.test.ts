import { beforeAll, describe, expect, it } from '@jest/globals';
import { useTestDb } from '../../testing/testDb';
import { getOrCreateVortexGroup, getVortexSyncRun, insertVortexSyncRun } from '../db';
import { patchVortexPlanUnit } from '../planUnits';
import { ensureVortexSchema } from '../schema';

describe('patchVortexPlanUnit', () => {
  const db = useTestDb();
  beforeAll(async () => ensureVortexSchema(db()));

  const makeRun = async () => {
    const group = await getOrCreateVortexGroup(db(), {
      game: 'fo4',
      groupKey: 'fo4:c:/vortex/fallout4/mods',
      label: 'Vortex · fallout4',
      stagingPath: 'C:/Vortex/fallout4/mods',
      gameDir: 'C:/Games/Fallout 4',
    });
    return insertVortexSyncRun(db(), {
      groupId: group.id,
      game: 'fo4',
      srcLang: 'en',
      tgtLang: 'uk',
      channel: 'all',
      plan: {
        groupKey: 'fo4:c:/vortex/fallout4/mods',
        units: [
          { unitId: 'a', action: 'upload', existingJobId: null },
          { unitId: 'b', action: 'upload', existingJobId: null },
        ],
      },
    });
  };

  const units = async (runId: number) =>
    ((await getVortexSyncRun(db(), runId))!.plan_json as { units: Array<Record<string, unknown>> })
      .units;

  it('changes only the named unit and keeps the order and the rest of the plan', async () => {
    const run = await makeRun();
    await patchVortexPlanUnit(db(), run.id, 'b', { existingJobId: 7, existingModId: 8 });

    expect(await units(run.id)).toEqual([
      { unitId: 'a', action: 'upload', existingJobId: null },
      { unitId: 'b', action: 'upload', existingJobId: 7, existingModId: 8 },
    ]);
    const plan = (await getVortexSyncRun(db(), run.id))!.plan_json as { groupKey: string };
    expect(plan.groupKey).toBe('fo4:c:/vortex/fallout4/mods');
  });

  it('keeps both results when two uploads to one run finish together', async () => {
    const run = await makeRun();
    await Promise.all([
      patchVortexPlanUnit(db(), run.id, 'a', { existingJobId: 1 }),
      patchVortexPlanUnit(db(), run.id, 'b', { rejected: 'Archive holds no files' }),
    ]);

    const [a, b] = await units(run.id);
    expect(a!.existingJobId).toBe(1);
    expect(b!.rejected).toBe('Archive holds no files');
  });
});
