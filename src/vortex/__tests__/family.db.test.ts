/**
 * Version families of Vortex mods against a real Postgres: plugins of one
 * folder share a Nexus id but are separate mods; a plugin-less folder keeps
 * the Nexus id / name key.
 */
import { describe, expect, it } from '@jest/globals';
import { upsertVortexMod } from '../../db/mods';
import { useTestDb } from '../../testing/testDb';
import { getOrCreateVortexGroup } from '../db';
import { findPreviousVortexMod, markCurrentVortexMods, planVortexUnits } from '../dbFamily';
import { ensureVortexSchema } from '../schema';
import type { VortexPlanPayload } from '../types';

const NEXUS = 48758;
const FOLDER = 'FallUI - Inventory-48758-2-2-1-1700000000';

type Unit = VortexPlanPayload['units'][number];

describe('vortex mod families', () => {
  const db = useTestDb();

  const group = async () =>
    (
      await getOrCreateVortexGroup(db(), {
        game: 'fo4',
        groupKey: 'gaming-pc',
        label: 'Gaming PC',
        stagingPath: 'C:/Vortex/fallout4/mods',
        gameDir: 'C:/Games/Fallout 4',
      })
    ).id;

  /** A mod row the way an import writes it; `plugin` is the anchor's file name. */
  const mod = async (
    groupId: number,
    name: string,
    hash: string,
    opts: { plugin?: string; nexus?: number; createdAt?: string } = {},
  ) => {
    const id = await upsertVortexMod(db(), {
      name,
      absPath: `/app/data/uploads/vortex/${groupId}/${hash}/${opts.plugin ?? 'Interface/x.txt'}`,
      versionHash: hash,
      game: 'fo4',
      groupId,
      channel: 'mods',
      vortexPlugin: opts.plugin?.toLowerCase() ?? null,
      nexus: { nexusModId: opts.nexus },
    });
    if (opts.createdAt) {
      await db().query(`UPDATE mods SET created_at = $2 WHERE id = $1`, [id, opts.createdAt]);
    }
    return id;
  };

  const unit = (name: string, hash: string, plugin: string | null, nexus: number | null): Unit => ({
    unitId: `${name}:${plugin ?? '-'}`,
    channel: 'mods',
    name,
    pluginStem: plugin ? plugin.replace(/\.es[mpl]$/i, '') : null,
    pluginFileName: plugin,
    sourceFolder: FOLDER,
    nexusModId: nexus,
    nexusModName: 'FallUI',
    contentHash: hash,
  });

  const plan = (groupId: number, units: Unit[]) =>
    planVortexUnits(db(), groupId, { groupKey: 'gaming-pc', units } as VortexPlanPayload);

  const current = async (groupId: number) => {
    const { rows } = await db().query<{ id: number }>(
      `SELECT id FROM mods WHERE vortex_group_id = $1 AND is_current ORDER BY id`,
      [groupId],
    );
    return rows.map((row) => row.id);
  };

  it('plans a sibling plugin as an upload, its own plugin as an update', async () => {
    const groupId = await group();
    const inventory = await mod(groupId, 'FallUI - Inventory', 'inv1', {
      plugin: 'FallUI - Inventory.esp',
      nexus: NEXUS,
    });

    const units = await plan(groupId, [
      unit('FallUI - VR-Patch', 'vr1', 'FallUI - VR-Patch.esp', NEXUS),
      unit('FallUI - Inventory', 'inv2', 'FALLUI - INVENTORY.ESP', NEXUS),
    ]);

    expect(units.map((u) => [u.action, u.existingModId])).toEqual([
      ['upload', null],
      ['update', inventory],
    ]);
  });

  it('keys a plugin-less folder on its Nexus id, apart from plugins', async () => {
    const groupId = await group();
    await mod(groupId, 'FallUI - Inventory', 'inv1', {
      plugin: 'FallUI - Inventory.esp',
      nexus: NEXUS,
    });
    const hud = await mod(groupId, 'FallUI - HUD', 'hud1', { nexus: NEXUS });

    const units = await plan(groupId, [
      unit('FallUI HUD (renamed)', 'hud2', null, NEXUS),
      unit('Workbench', 'wb1', null, null),
    ]);

    expect(units.map((u) => [u.action, u.existingModId])).toEqual([
      ['update', hud],
      ['upload', null],
    ]);
  });

  it('carries from the same plugin, never from a sibling plugin', async () => {
    const groupId = await group();
    const old = { nexus: NEXUS, createdAt: '2026-01-01T00:00:00Z' };
    const inventoryOld = await mod(groupId, 'FallUI - Inventory', 'inv1', {
      ...old,
      plugin: 'FallUI - Inventory.esp',
    });
    // Newer than the old Inventory: a Nexus-id lookup used to pick it.
    const vrOld = await mod(groupId, 'FallUI - VR-Patch', 'vr1', {
      nexus: NEXUS,
      plugin: 'FallUI - VR-Patch.esp',
      createdAt: '2026-01-02T00:00:00Z',
    });
    const inventoryNew = await mod(groupId, 'FallUI - Inventory', 'inv2', {
      nexus: NEXUS,
      plugin: 'FallUI - Inventory.esp',
    });
    const vrOnly = await mod(groupId, 'FallUI - VR-Patch', 'vr2', {
      nexus: NEXUS,
      plugin: 'FallUI - VR-Patch.esp',
    });
    const fresh = await mod(groupId, 'FallUI - Map', 'map1', {
      nexus: NEXUS,
      plugin: 'FallUI - Map.esp',
    });

    const previous = (newModId: number) => findPreviousVortexMod(db(), { groupId, newModId });

    expect(await previous(inventoryNew)).toBe(inventoryOld);
    expect(await previous(vrOnly)).toBe(vrOld);
    expect(await previous(fresh)).toBeNull();
  });

  it('finds a plugin-less version by name once the folder gained a Nexus id', async () => {
    const groupId = await group();
    const old = await mod(groupId, 'FallUI - HUD', 'hud1', { createdAt: '2026-01-01T00:00:00Z' });
    const renamed = await mod(groupId, 'FallUI - HUD', 'hud2', { nexus: NEXUS });

    expect(await findPreviousVortexMod(db(), { groupId, newModId: renamed })).toBe(old);
  });

  it('keeps every plugin of a folder current and archives only older versions', async () => {
    const groupId = await group();
    const old = { nexus: NEXUS, createdAt: '2026-01-01T00:00:00Z' };
    const inventoryOld = await mod(groupId, 'FallUI - Inventory', 'inv1', {
      ...old,
      plugin: 'FallUI - Inventory.esp',
    });
    const hudOld = await mod(groupId, 'FallUI - HUD', 'hud1', old);
    const inventory = await mod(groupId, 'FallUI - Inventory', 'inv2', {
      nexus: NEXUS,
      plugin: 'FallUI - Inventory.esp',
    });
    const vrPatch = await mod(groupId, 'FallUI - VR-Patch', 'vr1', {
      nexus: NEXUS,
      plugin: 'FallUI - VR-Patch.esp',
    });
    const hud = await mod(groupId, 'FallUI - HUD', 'hud2', { nexus: NEXUS });

    await markCurrentVortexMods(db(), groupId, [inventory, vrPatch, hud]);

    expect(await current(groupId)).toEqual([inventory, vrPatch, hud]);
    expect(await current(groupId)).not.toContain(inventoryOld);
    expect(await current(groupId)).not.toContain(hudOld);
  });

  it('backfills the plugin of mods imported before the column existed', async () => {
    const groupId = await group();
    const plugin = await mod(groupId, 'Workshop Plus', 'ws1', { plugin: 'WorkshopPlus.esp' });
    const windows = await mod(groupId, 'Old Path', 'op1');
    const loose = await mod(groupId, 'FallUI - HUD', 'hud1');
    await db().query(`UPDATE mods SET vortex_plugin = NULL`);
    await db().query(`UPDATE mods SET abs_path = $2 WHERE id = $1`, [
      windows,
      'C:\\Vortex\\mods\\Old Path\\OldPath.ESM',
    ]);

    await ensureVortexSchema(db());

    const { rows } = await db().query<{ id: number; vortex_plugin: string | null }>(
      `SELECT id, vortex_plugin FROM mods ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: plugin, vortex_plugin: 'workshopplus.esp' },
      { id: windows, vortex_plugin: 'oldpath.esm' },
      { id: loose, vortex_plugin: null },
    ]);
  });
});
