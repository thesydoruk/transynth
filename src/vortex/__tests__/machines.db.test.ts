/**
 * Machines of a Vortex group against a real Postgres: which machine a request
 * is for, what a machine's sync records as its own, and how a group synced
 * before machines existed hands its state to one.
 */
import { describe, expect, it } from '@jest/globals';
import { upsertVortexMod } from '../../db/mods';
import { useTestDb } from '../../testing/testDb';
import { getOrCreateVortexGroup, insertVortexSyncRun } from '../db';
import { markCurrentForSettledPlan, markCurrentVortexMods } from '../dbFamily';
import { ensureVortexMachine, resolveVortexMachine, setMachineExportOrder } from '../dbMachines';
import { upsertCurrentGameRelease } from '../dbReleases';
import { ensureVortexMachineSchema } from '../schemaMachines';
import type { VortexPlanUnit } from '../types';

const ORDER = { plugins: ['Fallout4.esm'], fileWinners: [] };

describe('vortex machines', () => {
  const db = useTestDb();

  const group = async () =>
    (
      await getOrCreateVortexGroup(db(), {
        game: 'fo4',
        groupKey: 'fo4:c:/vortex/fallout4/mods',
        label: 'Vortex · fallout4',
        stagingPath: 'C:/Vortex/fallout4/mods',
        gameDir: 'C:/Games/Fallout 4',
      })
    ).id;

  const mod = (groupId: number, name: string, hash: string) =>
    upsertVortexMod(db(), {
      name,
      absPath: `/app/data/uploads/vortex/${groupId}/${hash}/${name}.esp`,
      versionHash: hash,
      game: 'fo4',
      groupId,
      channel: 'mods',
      vortexPlugin: `${name.toLowerCase()}.esp`,
    });

  const machine = async (id: number) => {
    const { rows } = await db().query(
      `SELECT agent_key, staging_path, game_dir, present_mod_ids, export_order_json, game_release_id
       FROM vortex_agents WHERE id = $1`,
      [id],
    );
    return rows[0];
  };

  it('makes the machine a request names and keeps its paths', async () => {
    const groupId = await group();

    const first = await resolveVortexMachine(db(), groupId, ' desk ', {
      stagingPath: 'C:/Vortex/fallout4/mods',
      gameDir: 'D:/Games/Fallout 4',
    });
    const again = await resolveVortexMachine(db(), groupId, 'desk');

    expect(again).toBe(first);
    expect(await machine(first!)).toMatchObject({
      agent_key: 'desk',
      staging_path: 'C:/Vortex/fallout4/mods',
      game_dir: 'D:/Games/Fallout 4',
      present_mod_ids: null,
    });
  });

  it('takes an unnamed request for the only machine, and for none when there are two', async () => {
    const groupId = await group();
    expect(await resolveVortexMachine(db(), groupId, undefined)).toBeNull();

    const desk = await ensureVortexMachine(db(), groupId, 'desk');
    expect(await resolveVortexMachine(db(), groupId, '')).toBe(desk);

    await ensureVortexMachine(db(), groupId, 'laptop');
    expect(await resolveVortexMachine(db(), groupId, null)).toBeNull();
  });

  it('records the mods a sync found as that machine’s, and its game version', async () => {
    const groupId = await group();
    const desk = await ensureVortexMachine(db(), groupId, 'desk');
    const laptop = await ensureVortexMachine(db(), groupId, 'laptop');
    const a = await mod(groupId, 'A', 'a1');
    const b = await mod(groupId, 'B', 'b1');

    await markCurrentVortexMods(db(), groupId, [b, a], desk);
    const settled = [{ action: 'skip', existingModIds: [b] }] as VortexPlanUnit[];
    expect(await markCurrentForSettledPlan(db(), groupId, settled, laptop)).toBe(true);
    const release = await upsertCurrentGameRelease(
      db(),
      groupId,
      { versionLabel: '1.10.984', releaseHash: 'ng' },
      laptop,
    );

    expect(await machine(desk)).toMatchObject({ present_mod_ids: [a, b], game_release_id: null });
    expect(await machine(laptop)).toMatchObject({ present_mod_ids: [b], game_release_id: release });
  });

  it('hands a group’s earlier state to the machine seen last, once', async () => {
    const groupId = await group();
    const old = await ensureVortexMachine(db(), groupId, 'old-name');
    const desk = await ensureVortexMachine(db(), groupId, 'desk');
    await db().query(
      `UPDATE vortex_agents SET last_seen_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [old],
    );
    const current = await mod(groupId, 'A', 'a2');
    const archived = await mod(groupId, 'A', 'a1');
    await db().query(`UPDATE mods SET is_current = FALSE WHERE id = $1`, [archived]);
    await db().query(`UPDATE vortex_groups SET export_order_json = $2::jsonb WHERE id = $1`, [
      groupId,
      JSON.stringify(ORDER),
    ]);
    const release = await upsertCurrentGameRelease(db(), groupId, {
      versionLabel: '1.10.163',
      releaseHash: 'og',
    });
    const run = await insertVortexSyncRun(db(), {
      groupId,
      game: 'fo4',
      srcLang: 'en',
      tgtLang: 'uk',
      channel: 'all',
      plan: {},
    });

    await ensureVortexMachineSchema(db());

    expect(await machine(desk)).toMatchObject({
      present_mod_ids: [current],
      export_order_json: ORDER,
      game_release_id: release,
    });
    expect(await machine(old)).toMatchObject({ present_mod_ids: null, export_order_json: null });
    const { rows } = await db().query(`SELECT agent_id FROM vortex_sync_runs WHERE id = $1`, [
      run.id,
    ]);
    expect(rows).toEqual([{ agent_id: desk }]);

    // A machine that joins later takes nothing over, however recently it was seen.
    const laptop = await ensureVortexMachine(db(), groupId, 'laptop');
    await setMachineExportOrder(db(), desk, { plugins: [], fileWinners: [] });
    await ensureVortexMachineSchema(db());
    expect(await machine(laptop)).toMatchObject({ present_mod_ids: null, game_release_id: null });
    expect(await machine(desk)).toMatchObject({ present_mod_ids: [current] });
  });
});
